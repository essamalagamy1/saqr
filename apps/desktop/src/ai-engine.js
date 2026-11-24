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
    defaultConf: 0.12
  },
  phone: {
    filename: 'phone.onnx',
    numClasses: 1,
    classes: ['cell_phone'],
    statusMap: {
      cell_phone: { status: 'PHONE_DETECTED', label: 'مخالفة: استخدام الهاتف المحمول', isViolation: true, color: '#a855f7' }
    },
    defaultConf: 0.65
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
        // Read into buffer to support virtual Electron asar archives seamlessly
        const modelBuffer = fs.readFileSync(resolved);
        try {
          const session = await ort.InferenceSession.create(modelBuffer, {
            executionProviders: providers,
            graphOptimizationLevel: 'all',
          });
          this.sessions[key] = session;
          console.log(`[AI] 🚀 Loaded ${key} model from Buffer (${(modelBuffer.length / 1024 / 1024).toFixed(1)}MB)`);
        } catch (bufErr) {
          // Fallback to CPU with Buffer or path
          const session = await ort.InferenceSession.create(modelBuffer, {
            executionProviders: ['cpu'],
            graphOptimizationLevel: 'all',
          });
          this.sessions[key] = session;
          console.log(`[AI] ✅ Loaded ${key} model on CPU Buffer (${(modelBuffer.length / 1024 / 1024).toFixed(1)}MB)`);
        }
      } catch (err) {
        // Fallback to direct path if Buffer read failed
        try {
          const session = await ort.InferenceSession.create(resolved, {
            executionProviders: ['cpu'],
            graphOptimizationLevel: 'all',
          });
          this.sessions[key] = session;
          console.log(`[AI] ✅ Loaded ${key} model via path from ${resolved}`);
        } catch (fallbackErr) {
          console.error(`[AI] Failed to load ${key}:`, fallbackErr.message);
        }
      }
    }

    this.ready = Object.keys(this.sessions).length > 0;
  }

  /**
   * Preprocess JPEG buffer into normalized [1, 3, 640, 640] CHW Float32Array tensor
   * using standard YOLO letterbox padding (fit: 'contain', background 114).
   */
  async preprocess(frameBuffer) {
    const sharp = require('sharp');
    const meta = await sharp(frameBuffer).metadata();
    const origW = meta.width || 640;
    const origH = meta.height || 480;

    // Standard YOLO Letterbox: preserve aspect ratio with gray 114 background padding
    const scale = 640.0 / Math.max(origW, origH);
    const newW = Math.round(origW * scale);
    const newH = Math.round(origH * scale);
    const padX = (640 - newW) / 2.0;
    const padY = (640 - newH) / 2.0;

    const rawRgb = await sharp(frameBuffer)
      .resize(640, 640, {
        fit: 'contain',
        background: { r: 114, g: 114, b: 114 }
      })
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
      rawRgb,
      origW,
      origH,
      scale,
      padX,
      padY
    };
  }

  /**
   * Chromatic Face & Mask Analyzer for Black Masks and Black Headwear.
   * Specifically tuned for food handling environments where workers wear black masks and hairnets.
   */
  _analyzeBlackMaskAndHeadwear(rawRgb, scale, padX, padY, box) {
    if (!rawRgb) return null;
    const [x1, y1, x2, y2] = box;

    const b640_x1 = Math.max(0, Math.min(639, Math.round(x1 * scale + padX)));
    const b640_y1 = Math.max(0, Math.min(639, Math.round(y1 * scale + padY)));
    const b640_x2 = Math.max(0, Math.min(639, Math.round(x2 * scale + padX)));
    const b640_y2 = Math.max(0, Math.min(639, Math.round(y2 * scale + padY)));

    const bw = b640_x2 - b640_x1;
    const bh = b640_y2 - b640_y1;
    if (bw < 6 || bh < 6) return null;

    // 1. Lower Face Region (Nose bridge, mouth, chin - where the mask sits)
    const lower_y1 = Math.round(b640_y1 + bh * 0.40);
    const lower_y2 = Math.min(639, Math.round(b640_y2));
    const lower_x1 = Math.max(0, Math.round(b640_x1 + bw * 0.10));
    const lower_x2 = Math.min(639, Math.round(b640_x2 - bw * 0.10));

    let lowerDark = 0;
    let lowerTotal = 0;
    let lowerLumSum = 0;

    for (let y = lower_y1; y <= lower_y2; y++) {
      for (let x = lower_x1; x <= lower_x2; x++) {
        const idx = (y * 640 + x) * 3;
        const r = rawRgb[idx];
        const g = rawRgb[idx + 1];
        const b = rawRgb[idx + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        lowerLumSum += lum;
        lowerTotal++;
        if (lum < 75) {
          lowerDark++;
        }
      }
    }

    const lowerDarkRatio = lowerTotal > 0 ? (lowerDark / lowerTotal) : 0;
    const lowerAvgLum = lowerTotal > 0 ? (lowerLumSum / lowerTotal) : 128;

    // 2. Head Top Region (Black Hairnet / Cap check)
    const head_y1 = Math.max(0, Math.round(b640_y1 - bh * 0.30));
    const head_y2 = Math.min(639, Math.round(b640_y1 + bh * 0.15));
    const head_x1 = Math.max(0, Math.round(b640_x1 + bw * 0.15));
    const head_x2 = Math.min(639, Math.round(b640_x2 - bw * 0.15));

    let headDark = 0;
    let headTotal = 0;

    for (let y = head_y1; y <= head_y2; y++) {
      for (let x = head_x1; x <= head_x2; x++) {
        const idx = (y * 640 + x) * 3;
        const r = rawRgb[idx];
        const g = rawRgb[idx + 1];
        const b = rawRgb[idx + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        headTotal++;
        if (lum < 75) {
          headDark++;
        }
      }
    }

    const headDarkRatio = headTotal > 0 ? (headDark / headTotal) : 0;

    // 3. Torso / Uniform Region (Black T-Shirt - Official Staff Uniform)
    const torso_y1 = Math.min(639, Math.round(b640_y2 + bh * 0.20));
    const torso_y2 = Math.min(639, Math.round(b640_y2 + bh * 2.50));
    const torso_x1 = Math.max(0, Math.round(b640_x1 - bw * 0.80));
    const torso_x2 = Math.min(639, Math.round(b640_x2 + bw * 0.80));

    let torsoDark = 0;
    let torsoTotal = 0;
    let torsoLumSum = 0;

    for (let y = torso_y1; y <= torso_y2; y++) {
      for (let x = torso_x1; x <= torso_x2; x++) {
        const idx = (y * 640 + x) * 3;
        const r = rawRgb[idx];
        const g = rawRgb[idx + 1];
        const b = rawRgb[idx + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        torsoLumSum += lum;
        torsoTotal++;
        if (lum < 75) {
          torsoDark++;
        }
      }
    }

    const torsoDarkRatio = torsoTotal > 0 ? (torsoDark / torsoTotal) : 0;
    const torsoAvgLum = torsoTotal > 0 ? (torsoLumSum / torsoTotal) : 128;

    const hasBlackMask = lowerDarkRatio >= 0.28 || lowerAvgLum < 70;
    const hasBlackHeadCover = headDarkRatio >= 0.30;
    const hasBlackTshirt = torsoDarkRatio >= 0.38 || torsoAvgLum < 68;

    return {
      lowerDarkRatio,
      lowerAvgLum,
      headDarkRatio,
      torsoDarkRatio,
      torsoAvgLum,
      hasBlackMask,
      hasBlackHeadCover,
      hasBlackTshirt,
      isOfficialStaff: hasBlackTshirt
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

    const { float32, rawRgb, origW, origH, scale, padX, padY } = await this.preprocess(frameBuffer);
    const ort = require('onnxruntime-node');
    const tensor = new ort.Tensor('float32', float32, [1, 3, 640, 640]);

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

            // Un-letterbox back to original image space:
            const origCx = (cx - padX) / scale;
            const origCy = (cy - padY) / scale;
            const origWBox = w / scale;
            const origHBox = h / scale;

            const x1 = Math.max(0, Math.min(origW, Math.round(origCx - origWBox / 2)));
            const y1 = Math.max(0, Math.min(origH, Math.round(origCy - origHBox / 2)));
            const x2 = Math.max(0, Math.min(origW, Math.round(origCx + origWBox / 2)));
            const y2 = Math.max(0, Math.min(origH, Math.round(origCy + origHBox / 2)));

            const bw = x2 - x1;
            const bh = y2 - y1;

            if (bw > 8 && bh > 8) {
              const areaRatio = (bw * bh) / (origW * origH);
              const wRatio = bw / origW;
              const hRatio = bh / origH;

              // Physical CCTV Filter: A phone in a ceiling camera is a small handheld object
              // It can never cover whole dining tables, cars, counters, or floor segments
              if (modelKey === 'phone') {
                if (areaRatio > 0.04 || wRatio > 0.15 || hRatio > 0.20) {
                  continue;
                }
                if (bw < 14 || bh < 16) {
                  continue;
                }
              }

              // Face mask filter: face box cannot cover more than 20% of the entire camera screen
              if (modelKey === 'face_mask') {
                if (areaRatio > 0.20 || wRatio > 0.35 || hRatio > 0.40) {
                  continue;
                }
              }

              // Gloves & hand filter: hand box cannot cover more than 20% of the entire camera screen
              if (modelKey === 'gloves') {
                if (areaRatio > 0.20 || wRatio > 0.35 || hRatio > 0.40) {
                  continue;
                }
              }

              let rawClass = spec.classes[bestCls];
              let meta = spec.statusMap[rawClass] || { status: rawClass, label: rawClass, isViolation: false, color: '#3b82f6' };
              let score = parseFloat(maxScore.toFixed(3));

              // Specialized Black Mask, Black Headwear & Black T-Shirt (Uniform) Validation:
              // Official Workers in the facility wear Black T-Shirt, Black Mask, and Black Hairnet.
              if (modelKey === 'face_mask') {
                const uniform = this._analyzeBlackMaskAndHeadwear(rawRgb, scale, padX, padY, [x1, y1, x2, y2]);
                if (uniform) {
                  if (uniform.hasBlackMask) {
                    // Confirmed: Black mask is present on the lower face!
                    rawClass = 'with_mask';
                    let label = 'كمامة سوداء صحيحة (مطابق)';
                    if (uniform.hasBlackTshirt && uniform.hasBlackHeadCover) {
                      label = 'طاقم عمل مطابق: تيشرت أسود + كمامة وغطاء رأس';
                    } else if (uniform.hasBlackTshirt) {
                      label = 'عامل بالزي الرسمي: تيشرت أسود + كمامة';
                    } else if (uniform.hasBlackHeadCover) {
                      label = 'كمامة وغطاء رأس أسود (مطابق)';
                    }
                    meta = {
                      status: 'COMPLIANT',
                      label,
                      isViolation: false,
                      color: '#10b981'
                    };
                    score = Math.max(score, 0.94);
                  } else if (rawClass === 'without_mask' || uniform.lowerDarkRatio < 0.22) {
                    // Confirmed: Exposed face skin, no mask!
                    rawClass = 'without_mask';
                    meta = {
                      ...spec.statusMap['without_mask'],
                      label: uniform.hasBlackTshirt
                        ? 'عامل بالزي الرسمي (تيشرت أسود): بدون كمامة'
                        : 'مخالفة: بدون كمامة (وجه مكشوف)'
                    };
                  }
                }
              }

              // Gloves & Bare Hand Validation:
              if (modelKey === 'gloves') {
                if (rawClass === 'bare_hand') {
                  meta = {
                    ...spec.statusMap['bare_hand'],
                    label: 'عامل بالزي الرسمي (تيشرت أسود): يد مكشوفة بدون قفازات'
                  };
                }
              }

              candidates.push({
                model: modelKey,
                rawClass,
                label: meta.label,
                status: meta.status,
                isViolation: meta.isViolation,
                color: meta.color,
                score,
                box: [x1, y1, x2, y2]
              });
            }
          }
        }

        const nmsIou = modelKey === 'gloves' ? 0.35 : this.nmsThreshold;
        const filtered = this._applyNms(candidates, nmsIou);
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
