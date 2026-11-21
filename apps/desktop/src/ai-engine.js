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
    this.confThreshold = options.confThreshold || 0.22; // calibrated for distant CCTV persons
    this.nmsThreshold = options.nmsThreshold || 0.45;
    this.inputSize = options.inputSize || [640, 640];
    this.classes = options.classes || COCO_CLASSES;
    this.session = null;
    this.ready = false;
    this.prevFrames = new Map(); // cameraId -> grayscale buffer for motion fallback
  }

  /**
   * Initialize ONNX Runtime session if model exists.
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
      console.warn(`[AI] YOLOX model not found in standard paths. Active with motion-vision fallback.`);
      return;
    }

    try {
      const ort = require('onnxruntime-node');
      this.session = await ort.InferenceSession.create(resolvedPath, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      });
      this.ready = true;
      console.log(`[AI] ✅ YOLOX model loaded successfully from ${resolvedPath}`);
    } catch (err) {
      console.error('[AI] Failed to load YOLOX model:', err.message);
      this.session = null;
    }
  }

  /**
   * Preprocess a JPEG buffer into model input tensor.
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

    // Convert HWC (RGB from Sharp) -> CHW (BGR for Megvii YOLOX)
    const bgrOrder = [2, 1, 0];
    const float32Data = new Float32Array(3 * targetH * targetW);
    for (let c = 0; c < 3; c++) {
      const srcC = bgrOrder[c];
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
   */
  async detect(frameBuffer, cameraId = 'default') {
    if (!frameBuffer) return [];

    if (!this.session) {
      return await this._fallbackDetect(frameBuffer, cameraId);
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
      // When YOLOX model is active, trust its predictions directly (do not hallucinate false motion boxes on wall)
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

    const [targetH, targetW] = this.inputSize;
    const { grids, strides } = this._getStridesAndGrids(targetH, targetW);

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
      if (finalScore < this.confThreshold) continue;

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
   * Motion-vision fallback: detects when a person moves through camera field of view.
   * Eliminates fake alerts on static scenes while ensuring live moving persons are detected.
   */
  async _fallbackDetect(frameBuffer, cameraId = 'default') {
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
      // Motion threshold: between 0.6% and 40% of frame area (person walking)
      if (motionRatio >= 0.006 && motionRatio <= 0.40) {
        const scaleX = 1920 / 160;
        const scaleY = 1080 / 120;
        const box = [
          Math.max(0, Math.round(minX * scaleX)),
          Math.max(0, Math.round(minY * scaleY)),
          Math.min(1920, Math.round(maxX * scaleX)),
          Math.min(1080, Math.round(maxY * scaleY)),
        ];

        return [{
          label: 'person',
          classId: 0,
          score: Math.min(0.95, parseFloat((0.80 + motionRatio * 2).toFixed(2))),
          box,
        }];
      }
    } catch (e) {
      console.warn('[AI] Motion fallback error:', e.message);
    }
    return [];
  }

  async dispose() {
    if (this.session) {
      this.session = null;
      this.ready = false;
    }
  }
}

module.exports = AIEngine;
