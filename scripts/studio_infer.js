#!/usr/bin/env node
/**
 * Saqr Training Studio Inference & ONNX Validation Helper
 * Runs outside Next.js webpack bundling using apps/desktop's sharp + onnxruntime-node.
 *
 * Commands:
 *   node scripts/studio_infer.js infer <modelKey> <imagePath> [--raw] [--conf 0.25]
 *   node scripts/studio_infer.js batch-infer <modelKey> <samplesDir> [--conf 0.25]
 *   node scripts/studio_infer.js validate <onnxPath> <modelKey>
 */

const path = require('path');
const fs = require('fs');
const Module = require('module');

const SAQR_ROOT = path.resolve(__dirname, '..');
const DESKTOP_NODE_MODULES = path.join(SAQR_ROOT, 'apps', 'desktop', 'node_modules');
const ROOT_NODE_MODULES = path.join(SAQR_ROOT, 'node_modules');

// Ensure sharp & onnxruntime-node resolve cleanly regardless of caller CWD
const extraPaths = [DESKTOP_NODE_MODULES, ROOT_NODE_MODULES].filter(p => fs.existsSync(p));
if (extraPaths.length > 0) {
  process.env.NODE_PATH = [process.env.NODE_PATH, ...extraPaths].filter(Boolean).join(path.delimiter);
  Module._initPaths();
}

const AIEngine = require(path.join(SAQR_ROOT, 'apps', 'desktop', 'src', 'ai-engine.js'));

const MODEL_CLASS_INFO = {
  face_mask: {
    numClasses: 3,
    classes: ['with_mask', 'without_mask', 'mask_weared_incorrect'],
    labelsAr: {
      with_mask: 'كمامة صحيحة',
      without_mask: 'بدون كمامة',
      mask_weared_incorrect: 'ارتداء غير صحيح',
    },
    colors: {
      with_mask: '#10b981',
      without_mask: '#ef4444',
      mask_weared_incorrect: '#f59e0b',
    },
  },
  gloves: {
    numClasses: 2,
    classes: ['gloves', 'bare_hand'],
    labelsAr: {
      gloves: 'قفازات',
      bare_hand: 'يد بدون قفازات',
    },
    colors: {
      gloves: '#10b981',
      bare_hand: '#ef4444',
    },
  },
  phone: {
    numClasses: 1,
    classes: ['cell_phone'],
    labelsAr: {
      cell_phone: 'استخدام هاتف',
    },
    colors: {
      cell_phone: '#a855f7',
    },
  },
};

function toPercentDetections(detections, frameWidth, frameHeight, modelKey) {
  const info = MODEL_CLASS_INFO[modelKey];
  const fw = frameWidth || 640;
  const fh = frameHeight || 480;

  return detections.map(d => {
    const [x1, y1, x2, y2] = d.box;
    const x = parseFloat(((x1 / fw) * 100).toFixed(2));
    const y = parseFloat(((y1 / fh) * 100).toFixed(2));
    const width = parseFloat((((x2 - x1) / fw) * 100).toFixed(2));
    const height = parseFloat((((y2 - y1) / fh) * 100).toFixed(2));
    const className = d.rawClass || (info && info.classes[d.classId ?? 0]) || 'unknown';
    const classId = typeof d.classId === 'number'
      ? d.classId
      : Math.max(0, (info?.classes || []).indexOf(className));

    return {
      classId,
      className,
      label: d.label || info?.labelsAr?.[className] || className,
      color: d.color || info?.colors?.[className] || '#38bdf8',
      score: d.score,
      x,
      y,
      width,
      height,
      box: d.box,
    };
  });
}

async function validateOnnx(onnxPath, modelKey) {
  const info = MODEL_CLASS_INFO[modelKey];
  if (!info) {
    throw new Error(`Unknown modelKey: ${modelKey}`);
  }
  if (!fs.existsSync(onnxPath)) {
    throw new Error(`ONNX file not found: ${onnxPath}`);
  }

  const ort = require('onnxruntime-node');
  const buf = fs.readFileSync(onnxPath);
  const session = await ort.InferenceSession.create(buf, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });

  try {
    const dummy = new ort.Tensor('float32', new Float32Array(1 * 3 * 640 * 640), [1, 3, 640, 640]);
    const out = await session.run({ images: dummy });
    const outTensor = out.output0 || out[Object.keys(out)[0]];
    const dims = outTensor.dims;
    const expectedRows = 4 + info.numClasses;
    if (!dims || dims.length !== 3 || dims[0] !== 1 || dims[1] !== expectedRows || dims[2] !== 8400) {
      throw new Error(`Unexpected ONNX output dims ${JSON.stringify(dims)}, expected [1, ${expectedRows}, 8400]`);
    }
    return { valid: true, shape: dims, sizeBytes: buf.length };
  } finally {
    if (typeof session.release === 'function') {
      try { await session.release(); } catch {}
    }
  }
}

async function runSingle(modelKey, imagePath, rawMode, confThreshold) {
  if (!MODEL_CLASS_INFO[modelKey]) {
    throw new Error(`Unknown modelKey: ${modelKey}`);
  }
  const sharp = require('sharp');
  const buf = fs.readFileSync(imagePath);
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) {
    throw new Error('Invalid image file');
  }

  const ai = new AIEngine();
  await ai.init();

  const t0 = Date.now();
  const res = await ai.detect(buf, [modelKey], { rawMode, confThreshold });
  const inferenceMs = Date.now() - t0;

  return {
    success: true,
    modelKey,
    rawMode,
    frameWidth: res.frameWidth,
    frameHeight: res.frameHeight,
    inferenceMs,
    detections: toPercentDetections(res.detections, res.frameWidth, res.frameHeight, modelKey),
  };
}

async function runBatch(modelKey, samplesDir, confThreshold) {
  if (!MODEL_CLASS_INFO[modelKey]) {
    throw new Error(`Unknown modelKey: ${modelKey}`);
  }
  const ai = new AIEngine();
  await ai.init();

  const files = fs.readdirSync(samplesDir)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .sort();

  const results = {};
  for (const fname of files) {
    const fpath = path.join(samplesDir, fname);
    const buf = fs.readFileSync(fpath);
    const t0 = Date.now();
    const rawRes = await ai.detect(buf, [modelKey], { rawMode: true, confThreshold });
    const inferenceMs = Date.now() - t0;
    results[fname] = {
      frameWidth: rawRes.frameWidth,
      frameHeight: rawRes.frameHeight,
      inferenceMs,
      detections: toPercentDetections(rawRes.detections, rawRes.frameWidth, rawRes.frameHeight, modelKey),
    };
  }

  return { success: true, modelKey, results };
}

function getArg(args, flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1] !== undefined) return args[idx + 1];
  return fallback;
}

(async () => {
  const [, , cmd, ...rest] = process.argv;
  try {
    if (cmd === 'validate') {
      const [onnxPath, modelKey] = rest;
      const out = await validateOnnx(onnxPath, modelKey);
      console.log(JSON.stringify(out));
    } else if (cmd === 'infer') {
      const [modelKey, imagePath] = rest;
      const rawMode = rest.includes('--raw');
      const confArg = getArg(rest, '--conf', undefined);
      const conf = confArg !== undefined ? parseFloat(confArg) : undefined;
      const out = await runSingle(
        modelKey,
        imagePath,
        rawMode,
        conf !== undefined && Number.isFinite(conf) ? conf : undefined
      );
      console.log(JSON.stringify(out));
    } else if (cmd === 'batch-infer') {
      const [modelKey, samplesDir] = rest;
      const conf = parseFloat(getArg(rest, '--conf', '0.25'));
      const out = await runBatch(modelKey, samplesDir, Number.isFinite(conf) ? conf : 0.25);
      console.log(JSON.stringify(out));
    } else {
      throw new Error(`Unsupported command: ${cmd}`);
    }
    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  }
})();
