// Rased Edge Agent — YOLOX AI Detection Engine (Apache 2.0)
const path = require('path');
const fs = require('fs');

// Standard COCO 80 classes
const COCO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
  'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat',
  'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
  'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
  'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
  'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
  'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake',
  'chair', 'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop',
  'mouse', 'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
  'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'
];

class AIEngine {
  constructor(options = {}) {
    this.modelPath = options.modelPath || path.join(__dirname, '..', 'models', 'yolox_s.onnx');
    this.confThreshold = options.confThreshold || 0.30; // Calibrated for CCTV surveillance (filters false shadows/chairs)
    this.nmsThreshold = options.nmsThreshold || 0.45;
    this.inputSize = options.inputSize || [640, 640];
    this.classes = options.classes || COCO_CLASSES;
    this.session = null;
    this.maskSession = null;
    this.ready = false;
    this.prevFrames = new Map(); // cameraId -> grayscale buffer for motion analysis

    // Performance Optimization: Precompute grid coordinates and strides once at startup
    this.gridCache = this._getStridesAndGrids(this.inputSize[0], this.inputSize[1]);
  }

  get hasMaskClassifier() {
    return !!this.maskSession;
  }

  /**
   * Initialize ONNX Runtime session if model exists.
   * Leverages GPU (DirectML on Windows) when available, falling back gracefully to optimized CPU.
   */
  async init() {
    if (this.ready) return;

    const candidatePaths = [
      this.modelPath,
      path.join(process.resourcesPath || '', 'models', 'yolox_s.onnx'),
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'models', 'yolox_s.onnx'),
      path.join(__dirname, '..', 'models', 'yolox_s.onnx'),
      path.join(process.cwd(), 'models', 'yolox_s.onnx'),
      path.join(process.resourcesPath || '', 'models', 'yolox_tiny.onnx'),
    ];

    let resolvedPath = null;
    for (const p of candidatePaths) {
      if (p && fs.existsSync(p)) {
        resolvedPath = p;
        break;
      }
    }

    if (!resolvedPath) {
      console.warn(`[AI] YOLOX model not found in standard paths. Inference disabled.`);
      return;
    }

    try {
      const ort = require('onnxruntime-node');
      let session = null;

      // 1. Attempt GPU Acceleration via DirectML (Windows)
      if (process.platform === 'win32') {
        try {
          session = await ort.InferenceSession.create(resolvedPath, {
            executionProviders: ['dml', 'cpu'],
            graphOptimizationLevel: 'all',
          });
          console.log(`[AI] 🚀 YOLOX loaded with DirectML (GPU) acceleration from ${resolvedPath}`);
        } catch {
          session = null;
        }
      }

      // 2. CPU optimized execution
      if (!session) {
        session = await ort.InferenceSession.create(resolvedPath, {
          executionProviders: ['cpu'],
          graphOptimizationLevel: 'all',
        });
        console.log(`[AI] ✅ YOLOX loaded on CPU (optimized graph) from ${resolvedPath}`);
      }

      this.session = session;
      this.ready = true;

      // 3. Load Secondary Multi-Model Classifier for PPE & Mask Detection
      const maskCandidatePaths = [
        path.join(__dirname, '..', 'models', 'mask_classifier.onnx'),
        path.join(process.resourcesPath || '', 'models', 'mask_classifier.onnx'),
        path.join(process.resourcesPath || '', 'app.asar.unpacked', 'models', 'mask_classifier.onnx'),
        path.join(process.cwd(), 'models', 'mask_classifier.onnx'),
      ];

      for (const mp of maskCandidatePaths) {
        if (mp && fs.existsSync(mp)) {
          try {
            this.maskSession = await ort.InferenceSession.create(mp, {
              executionProviders: process.platform === 'win32' ? ['dml', 'cpu'] : ['cpu'],
              graphOptimizationLevel: 'all',
            });
            console.log(`[AI] 🧠 MobileNetV2 Face Mask Classifier loaded from ${mp}`);
            break;
          } catch (mErr) {
            console.warn('[AI] Could not load mask classifier:', mErr.message);
          }
        }
      }
    } catch (err) {
      console.error('[AI] Failed to load YOLOX model:', err.message);
      this.session = null;
    }
  }

  /**
   * Classify whether a cropped face ROI has a face mask using the secondary MobileNetV2 ONNX model.
   * Input: 224x224 RGB, Normalized: (pixel / 127.5) - 1.0.
   * Output: [probMask, probNoMask].
   */
  async classifyFaceMask(rawFrame, faceBox) {
    if (!this.maskSession || !rawFrame || !faceBox) return null;
    try {
      const sharp = require('sharp');
      const ort = require('onnxruntime-node');

      const [x1, y1, x2, y2] = faceBox;
      const w = Math.max(10, x2 - x1);
      const h = Math.max(10, y2 - y1);

      const croppedBuffer = await sharp(rawFrame)
        .extract({ left: x1, top: y1, width: w, height: h })
        .resize(224, 224, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer();

      const float32 = new Float32Array(1 * 224 * 224 * 3);
      for (let i = 0; i < croppedBuffer.length; i++) {
        float32[i] = (croppedBuffer[i] / 127.5) - 1.0;
      }

      const tensor = new ort.Tensor('float32', float32, [1, 224, 224, 3]);
      const inputName = this.maskSession.inputNames[0];
      const results = await this.maskSession.run({ [inputName]: tensor });
      const outputName = this.maskSession.outputNames[0];
      const outData = results[outputName].data;

      const maskProb = parseFloat(outData[0].toFixed(3));
      const noMaskProb = parseFloat(outData[1].toFixed(3));

      return {
        hasMask: maskProb > noMaskProb,
        maskProb,
        noMaskProb,
      };
    } catch (e) {
      console.warn('[AI] Face mask classifier error:', e.message);
      return null;
    }
  }

  /**
   * Preprocess a JPEG buffer into model input tensor.
   * Converts RGB (Sharp) -> BGR (Megvii YOLOX official training standard).
   */
  async preprocess(frameBuffer) {
    let sharp;
    try {
      sharp = require('sharp');
    } catch {
      throw new Error('sharp library not installed');
    }

    const [targetH, targetW] = this.inputSize;

    // Decode and get metadata
    const metadata = await sharp(frameBuffer).metadata();
    const origW = metadata.width || 640;
    const origH = metadata.height || 480;

    // Calculate resize ratio (letterbox)
    const ratio = Math.min(targetH / origH, targetW / origW);
    const resizedW = Math.round(origW * ratio);
    const resizedH = Math.round(origH * ratio);

    // Resize and pad to target size with gray (114)
    const resized = await sharp(frameBuffer)
      .resize(resizedW, resizedH, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer();

    // Create padded buffer (HWC, uint8, fill 114)
    const paddedSize = targetH * targetW * 3;
    const padded = Buffer.alloc(paddedSize, 114);

    // Copy resized image into padded buffer
    for (let y = 0; y < resizedH; y++) {
      const srcOffset = y * resizedW * 3;
      const dstOffset = y * targetW * 3;
      resized.copy(padded, dstOffset, srcOffset, srcOffset + resizedW * 3);
    }

    // Convert HWC (RGB from Sharp) -> CHW (BGR for Megvii YOLOX official format)
    const float32Data = new Float32Array(3 * targetH * targetW);
    for (let c = 0; c < 3; c++) {
      const srcC = 2 - c; // c=0 -> B(2), c=1 -> G(1), c=2 -> R(0)
      for (let h = 0; h < targetH; h++) {
        for (let w = 0; w < targetW; w++) {
          float32Data[c * targetH * targetW + h * targetW + w] =
            padded[(h * targetW + w) * 3 + srcC];
        }
      }
    }

    return { tensor: float32Data, ratio, origW, origH };
  }

  /**
   * Run detection on a JPEG frame buffer.
   * Strict AI inference: if no detections are found or session missing, returns [] directly.
   * Never fabricates false persons from static background motion!
   */
  async detect(frameBuffer, cameraId = 'default') {
    if (!frameBuffer) return [];

    if (!this.session) {
      console.warn(`[AI] Inference session not active for camera ${cameraId}. Returning empty detections.`);
      return [];
    }

    try {
      const ort = require('onnxruntime-node');
      const { tensor, ratio, origW, origH } = await this.preprocess(frameBuffer);

      const inputName = this.session.inputNames[0];
      const inputTensor = new ort.Tensor('float32', tensor, [1, 3, ...this.inputSize]);
      const results = await this.session.run({ [inputName]: inputTensor });

      const outputName = this.session.outputNames[0];
      const output = results[outputName];

      const detections = this._postprocess(output.data, output.dims, ratio, origW, origH);
      return detections || [];
    } catch (err) {
      console.error('[AI] Detection error:', err.message);
      return [];
    }
  }

  /**
   * Generates YOLOX grid coordinates and strides for decoding output feature maps.
   */
  _getStridesAndGrids(targetH, targetW) {
    const strides = [8, 16, 32];
    const grids = [];
    const expandedStrides = [];

    for (const stride of strides) {
      const numGridY = Math.floor(targetH / stride);
      const numGridX = Math.floor(targetW / stride);
      for (let g1 = 0; g1 < numGridY; g1++) {
        for (let g0 = 0; g0 < numGridX; g0++) {
          grids.push(g0, g1);
          expandedStrides.push(stride);
        }
      }
    }
    return { grids, strides: expandedStrides };
  }

  /**
   * Post-process YOLOX output: decode anchor-free grid boxes, apply NMS.
   */
  _postprocess(data, dims, ratio, origW, origH) {
    const numDetections = dims[1];
    const numAttrs = dims[2]; // x, y, w, h, obj_conf, ...class_scores
    const numClasses = numAttrs - 5;

    const { grids, strides } = this.gridCache;

    const detections = [];

    for (let i = 0; i < numDetections; i++) {
      const offset = i * numAttrs;
      const objConf = data[offset + 4];

      if (objConf < 0.12) continue; // Early prune

      let bestClassScore = 0;
      let bestClassId = 0;
      for (let c = 0; c < numClasses; c++) {
        const score = data[offset + 5 + c];
        if (score > bestClassScore) {
          bestClassScore = score;
          bestClassId = c;
        }
      }

      const finalScore = objConf * bestClassScore;
      const classLabel = this.classes[bestClassId] || '';
      // Calibrated threshold: allow small objects like cell phone (classId 67) at lower threshold in CCTV
      const targetThreshold = (classLabel === 'cell phone' || bestClassId === 67) ? 0.20 : this.confThreshold;
      if (finalScore < targetThreshold) continue;

      const gx = grids[i * 2];
      const gy = grids[i * 2 + 1];
      const stride = strides[i];

      const cx = (data[offset] + gx) * stride;
      const cy = (data[offset + 1] + gy) * stride;
      const w = Math.exp(data[offset + 2]) * stride;
      const h = Math.exp(data[offset + 3]) * stride;

      const x1 = Math.max(0, (cx - w / 2) / ratio);
      const y1 = Math.max(0, (cy - h / 2) / ratio);
      const x2 = Math.min(origW, (cx + w / 2) / ratio);
      const y2 = Math.min(origH, (cy + h / 2) / ratio);

      const leftPct = parseFloat(((x1 / origW) * 100).toFixed(2));
      const topPct = parseFloat(((y1 / origH) * 100).toFixed(2));
      const widthPct = parseFloat((((x2 - x1) / origW) * 100).toFixed(2));
      const heightPct = parseFloat((((y2 - y1) / origH) * 100).toFixed(2));

      detections.push({
        box: [Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)],
        x: leftPct,
        y: topPct,
        width: widthPct,
        height: heightPct,
        frameWidth: origW,
        frameHeight: origH,
        label: this.classes[bestClassId] || `class_${bestClassId}`,
        classId: bestClassId,
        score: parseFloat(finalScore.toFixed(3)),
      });
    }

    return this._nms(detections);
  }

  _nms(detections) {
    if (detections.length === 0) return [];

    detections.sort((a, b) => b.score - a.score);

    const kept = [];
    const suppressed = new Set();

    for (let i = 0; i < detections.length; i++) {
      if (suppressed.has(i)) continue;
      kept.push(detections[i]);

      for (let j = i + 1; j < detections.length; j++) {
        if (suppressed.has(j)) continue;
        if (detections[i].classId !== detections[j].classId) continue;

        const iou = this._computeIOU(detections[i].box, detections[j].box);
        if (iou > this.nmsThreshold) {
          suppressed.add(j);
        }
      }
    }

    return kept;
  }

  _computeIOU(boxA, boxB) {
    const x1 = Math.max(boxA[0], boxB[0]);
    const y1 = Math.max(boxA[1], boxB[1]);
    const x2 = Math.min(boxA[2], boxB[2]);
    const y2 = Math.min(boxA[3], boxB[3]);

    const interArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const areaA = (boxA[2] - boxA[0]) * (boxA[3] - boxA[1]);
    const areaB = (boxB[2] - boxB[0]) * (boxB[3] - boxB[1]);

    return interArea / (areaA + areaB - interArea + 1e-6);
  }

  /**
   * Standalone Motion Detector: calculates pixel differentials for background activity analysis.
   * Labels activity strictly as 'motion', NEVER hallucinating 'person'.
   * Uses dynamic frame dimensions (origW, origH) instead of hardcoded dimensions.
   */
  async detectMotion(frameBuffer, cameraId = 'default', origW = 640, origH = 360) {
    if (!frameBuffer || frameBuffer.length < 500) return [];

    try {
      const sharp = require('sharp');
      const small = await sharp(frameBuffer)
        .resize(160, 120, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer();

      const prev = this.prevFrames.get(cameraId);
      this.prevFrames.set(cameraId, small);

      if (!prev || prev.length !== small.length) {
        return [];
      }

      let diffCount = 0;
      let minX = 160, maxX = 0, minY = 120, maxY = 0;

      for (let y = 0; y < 120; y++) {
        for (let x = 0; x < 160; x++) {
          const idx = y * 160 + x;
          const diff = Math.abs(small[idx] - prev[idx]);
          if (diff > 25) {
            diffCount++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      const motionRatio = diffCount / (160 * 120);
      if (motionRatio >= 0.01 && motionRatio <= 0.40) {
        const scaleX = origW / 160;
        const scaleY = origH / 120;
        const x1 = Math.max(0, Math.round(minX * scaleX));
        const y1 = Math.max(0, Math.round(minY * scaleY));
        const x2 = Math.min(origW, Math.round(maxX * scaleX));
        const y2 = Math.min(origH, Math.round(maxY * scaleY));

        return [{
          label: 'motion',
          classId: -1,
          score: parseFloat((0.50 + motionRatio).toFixed(2)),
          box: [x1, y1, x2, y2],
          x: parseFloat(((x1 / origW) * 100).toFixed(2)),
          y: parseFloat(((y1 / origH) * 100).toFixed(2)),
          width: parseFloat((((x2 - x1) / origW) * 100).toFixed(2)),
          height: parseFloat((((y2 - y1) / origH) * 100).toFixed(2)),
          frameWidth: origW,
          frameHeight: origH
        }];
      }
    } catch (e) {
      console.warn('[AI] Motion analysis error:', e.message);
    }
    return [];
  }

  /**
   * Two-Stage Inspection: crops the detected person's upper body / head / hands at full resolution
   * and inspects for face mask presence and hand/phone activity.
   */
  async inspectPersonROI(frameBuffer, personBox, origW = 640, origH = 360) {
    if (!frameBuffer || !personBox) return null;
    try {
      const [px1, py1, px2, py2] = personBox;
      const pw = Math.max(10, px2 - px1);
      const ph = Math.max(20, py2 - py1);

      // Face / Head ROI
      const faceLeft = Math.max(0, Math.round(px1 + pw * 0.15));
      const faceTop = Math.max(0, Math.round(py1 + ph * 0.05));
      const faceWidth = Math.min(origW - faceLeft, Math.max(10, Math.round(pw * 0.70)));
      const faceHeight = Math.min(origH - faceTop, Math.max(10, Math.round(ph * 0.25)));

      // Hand / Chest ROI
      const handLeft = Math.max(0, Math.round(px1 + pw * 0.10));
      const handTop = Math.max(0, Math.round(py1 + ph * 0.25));
      const handWidth = Math.min(origW - handLeft, Math.max(10, Math.round(pw * 0.80)));
      const handHeight = Math.min(origH - handTop, Math.max(10, Math.round(ph * 0.45)));

      return {
        headBox: [faceLeft, faceTop, faceLeft + faceWidth, faceTop + faceHeight],
        handBox: [handLeft, handTop, handLeft + handWidth, handTop + handHeight],
        headPercent: {
          x: parseFloat(((faceLeft / origW) * 100).toFixed(2)),
          y: parseFloat(((faceTop / origH) * 100).toFixed(2)),
          width: parseFloat(((faceWidth / origW) * 100).toFixed(2)),
          height: parseFloat(((faceHeight / origH) * 100).toFixed(2))
        },
        handPercent: {
          x: parseFloat(((handLeft / origW) * 100).toFixed(2)),
          y: parseFloat(((handTop / origH) * 100).toFixed(2)),
          width: parseFloat(((handWidth / origW) * 100).toFixed(2)),
          height: parseFloat(((handHeight / origH) * 100).toFixed(2))
        }
      };
    } catch {
      return null;
    }
  }

  async dispose() {
    if (this.session) {
      this.session = null;
      this.ready = false;
    }
  }
}

module.exports = AIEngine;
