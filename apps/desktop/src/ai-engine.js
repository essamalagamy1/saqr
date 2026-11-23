// Saqr Edge Agent — Multi-Model AI Detection Engine (YOLO26 ONNX)
// Handles 3 Independent Models: Face Mask, Gloves & Bare Hand, and Mobile Phone.
// Zero Python runtime dependency — Blazing fast ONNX Runtime with DirectML/CPU support.

const path = require('path');
const fs = require('fs');

const MODEL_SPECS = {
  face_mask: {
    filename: 'face_mask.onnx',
    numClasses: 3,
    classes: ['with_mask', 'without_mask', 'mask_weared_incorrect'],
    statusMap: {
      with_mask: { status: 'COMPLIANT', label: 'كمامة صحيحة', isViolation: false, color: '#10b981' },
      without_mask: { status: 'NO_MASK', label: 'مخالفة: بدون كمامة', isViolation: true, color: '#ef4444' },
      mask_weared_incorrect: { status: 'INCORRECT_MASK', label: 'مخالفة: ارتداء كمامة غير صحيح', isViolation: true, color: '#f59e0b' }
    },
    defaultConf: 0.30
  },
  gloves: {
    filename: 'gloves.onnx',
    numClasses: 2,
    classes: ['gloves', 'bare_hand'],
    statusMap: {
      gloves: { status: 'GLOVES_COMPLIANT', label: 'قفازات نظيفة', isViolation: false, color: '#10b981' },
      bare_hand: { status: 'BARE_HAND_VIOLATION', label: 'مخالفة: يد مكشوفة بدون قفازات', isViolation: true, color: '#ef4444' }
    },
    defaultConf: 0.30
  },
  phone: {
    filename: 'phone.onnx',
    numClasses: 1,
    classes: ['cell_phone'],
    statusMap: {
      cell_phone: { status: 'PHONE_DETECTED', label: 'مخالفة: استخدام الهاتف المحمول', isViolation: true, color: '#a855f7' }
    },
    defaultConf: 0.25
  }
};

class AIEngine {
  constructor(options = {}) {
    this.confThreshold = options.confThreshold || 0.30;
    this.nmsThreshold = options.nmsThreshold || 0.45;
    this.inputSize = [640, 640];
    this.sessions = {}; // modelKey -> ort.InferenceSession
    this.ready = false;
  }

  _resolveModelPath(filename) {
    const candidates = [
      path.join(__dirname, '..', 'models', filename),
      path.join(process.resourcesPath || '', 'models', filename),
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'models', filename),
      path.join(process.cwd(), 'models', filename),
      path.join(__dirname, '..', '..', '..', 'computer-vision', filename.replace('.onnx', ''), 'weights', 'best.onnx')
    ];

    for (const p of candidates) {
      if (p && fs.existsSync(p)) {
        return p;
      }
    }
    return null;
  }

  /**
   * Initializes ONNX runtime sessions for all 3 models.
   * Leverages GPU (DirectML on Windows) when available, falling back to CPU.
   */
  async init() {
    if (this.ready) return;

    let ort;
    try {
      ort = require('onnxruntime-node');
    } catch (err) {
      console.warn('[AI] onnxruntime-node not available:', err.message);
      return;
    }

    const providers = process.platform === 'win32' ? ['dml', 'cpu'] : ['cpu'];

    for (const [key, spec] of Object.entries(MODEL_SPECS)) {
      const resolved = this._resolveModelPath(spec.filename);
      if (!resolved) {
        console.warn(`[AI] Model ${spec.filename} not found in paths. Skipping.`);
        continue;
      }

      try {
        const session = await ort.InferenceSession.create(resolved, {
          executionProviders: providers,
          graphOptimizationLevel: 'all',
        });
        this.sessions[key] = session;
        console.log(`[AI] 🚀 Loaded ${key} model from ${resolved}`);
      } catch (err) {
        // Fallback to CPU only if DirectML fails
        try {
          const session = await ort.InferenceSession.create(resolved, {
            executionProviders: ['cpu'],
            graphOptimizationLevel: 'all',
          });
          this.sessions[key] = session;
          console.log(`[AI] ✅ Loaded ${key} model on CPU from ${resolved}`);
        } catch (cpuErr) {
          console.error(`[AI] Failed to load ${key}:`, cpuErr.message);
        }
      }
    }

    this.ready = Object.keys(this.sessions).length > 0;
  }

  /**
   * Preprocess JPEG buffer into normalized [1, 3, 640, 640] CHW Float32Array tensor.
   */
  async preprocess(frameBuffer) {
    const sharp = require('sharp');
    const meta = await sharp(frameBuffer).metadata();
    const origW = meta.width || 640;
    const origH = meta.height || 480;

    const rawRgb = await sharp(frameBuffer)
      .resize(640, 640, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer();

    const channelSize = 640 * 640;
    const float32 = new Float32Array(3 * channelSize);

    for (let i = 0; i < channelSize; i++) {
      float32[0 * channelSize + i] = rawRgb[i * 3 + 0] / 255.0; // R
      float32[1 * channelSize + i] = rawRgb[i * 3 + 1] / 255.0; // G
      float32[2 * channelSize + i] = rawRgb[i * 3 + 2] / 255.0; // B
    }

    return {
      float32,
      origW,
      origH
    };
  }

  /**
   * Non-Maximum Suppression (NMS) for candidate bounding boxes.
   */
  _applyNms(boxes, iouThreshold = 0.45) {
    if (boxes.length <= 1) return boxes;
    boxes.sort((a, b) => b.score - a.score);

    const kept = [];
    const suppressed = new Uint8Array(boxes.length);

    for (let i = 0; i < boxes.length; i++) {
      if (suppressed[i]) continue;
      const b1 = boxes[i];
      kept.push(b1);

      const [x1A, y1A, x2A, y2A] = b1.box;
      const areaA = (x2A - x1A) * (y2A - y1A);

      for (let j = i + 1; j < boxes.length; j++) {
        if (suppressed[j]) continue;
        const b2 = boxes[j];
        const [x1B, y1B, x2B, y2B] = b2.box;
        const areaB = (x2B - x1B) * (y2B - y1B);

        const interX1 = Math.max(x1A, x1B);
        const interY1 = Math.max(y1A, y1B);
        const interX2 = Math.min(x2A, x2B);
        const interY2 = Math.min(y2A, y2B);

        const interW = Math.max(0, interX2 - interX1);
        const interH = Math.max(0, interY2 - interY1);
        const interArea = interW * interH;
        const unionArea = areaA + areaB - interArea;

        const iou = unionArea > 0 ? interArea / unionArea : 0;
        if (iou > iouThreshold) {
          suppressed[j] = 1;
        }
      }
    }
    return kept;
  }

  /**
   * Run inference on a frame with the active models assigned to this camera.
   * activeModels: string[] e.g. ['face_mask', 'gloves', 'phone']
   */
  async detect(frameBuffer, activeModels = ['face_mask', 'gloves', 'phone']) {
    if (!this.ready) {
      await this.init();
    }
    if (!frameBuffer || frameBuffer.length < 5000) {
      return { detections: [], frameWidth: 1280, frameHeight: 720 };
    }

    const { float32, origW, origH } = await this.preprocess(frameBuffer);
    const ort = require('onnxruntime-node');
    const tensor = new ort.Tensor('float32', float32, [1, 3, 640, 640]);

    const scaleX = origW / 640.0;
    const scaleY = origH / 640.0;

    const modelsToRun = activeModels.filter(m => this.sessions[m]);
    if (modelsToRun.length === 0) {
      return { detections: [], frameWidth: origW, frameHeight: origH };
    }

    const allDetections = [];

    // Run active models concurrently
    await Promise.all(modelsToRun.map(async (modelKey) => {
      const session = this.sessions[modelKey];
      const spec = MODEL_SPECS[modelKey];
      const confLimit = spec.defaultConf || this.confThreshold;

      try {
        const out = await session.run({ images: tensor });
        const data = out.output0 ? out.output0.data : out[Object.keys(out)[0]].data;

        const candidates = [];
        const numClasses = spec.numClasses;

        for (let i = 0; i < 8400; i++) {
          let maxScore = 0;
          let bestCls = 0;

          for (let c = 0; c < numClasses; c++) {
            const score = data[(4 + c) * 8400 + i];
            if (score > maxScore) {
              maxScore = score;
              bestCls = c;
            }
          }

          if (maxScore >= confLimit) {
            const cx = data[0 * 8400 + i];
            const cy = data[1 * 8400 + i];
            const w = data[2 * 8400 + i];
            const h = data[3 * 8400 + i];

            const x1 = Math.max(0, Math.min(origW, Math.round((cx - w / 2) * scaleX)));
            const y1 = Math.max(0, Math.min(origH, Math.round((cy - h / 2) * scaleY)));
            const x2 = Math.max(0, Math.min(origW, Math.round((cx + w / 2) * scaleX)));
            const y2 = Math.max(0, Math.min(origH, Math.round((cy + h / 2) * scaleY)));

            if (x2 > x1 + 8 && y2 > y1 + 8) {
              const rawClass = spec.classes[bestCls];
              const meta = spec.statusMap[rawClass] || { status: rawClass, label: rawClass, isViolation: false, color: '#3b82f6' };

              candidates.push({
                model: modelKey,
                rawClass,
                label: meta.label,
                status: meta.status,
                isViolation: meta.isViolation,
                color: meta.color,
                score: parseFloat(maxScore.toFixed(3)),
                box: [x1, y1, x2, y2]
              });
            }
          }
        }

        const filtered = this._applyNms(candidates, this.nmsThreshold);
        allDetections.push(...filtered);
      } catch (err) {
        console.warn(`[AI] Inference error on ${modelKey}:`, err.message);
      }
    }));

    return {
      detections: allDetections,
      frameWidth: origW,
      frameHeight: origH
    };
  }
}

module.exports = AIEngine;
