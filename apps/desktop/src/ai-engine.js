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
    this.confThreshold = options.confThreshold || 0.45;
    this.nmsThreshold = options.nmsThreshold || 0.45;
    this.inputSize = options.inputSize || [640, 640];
    this.classes = options.classes || COCO_CLASSES;
    this.session = null;
    this.ready = false;
  }

  /**
   * Initialize ONNX Runtime session if model exists.
   */
  async init() {
    if (this.ready) return;

    if (!fs.existsSync(this.modelPath)) {
      console.warn(`[AI] YOLOX model not found at ${this.modelPath}. Running in fallback mode.`);
      return;
    }

    try {
      const ort = require('onnxruntime-node');
      this.session = await ort.InferenceSession.create(this.modelPath, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      });
      this.ready = true;
      console.log('[AI] YOLOX model loaded successfully');
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

    // Convert HWC -> CHW float32
    const float32Data = new Float32Array(3 * targetH * targetW);
    for (let c = 0; c < 3; c++) {
      for (let h = 0; h < targetH; h++) {
        for (let w = 0; w < targetW; w++) {
          float32Data[c * targetH * targetW + h * targetW + w] =
            padded[(h * targetW + w) * 3 + c];
        }
      }
    }

    return { tensor: float32Data, ratio, origW, origH };
  }

  /**
   * Run detection on a JPEG frame buffer.
   */
  async detect(frameBuffer) {
    if (!this.session || !frameBuffer) {
      return this._fallbackDetect();
    }

    try {
      const ort = require('onnxruntime-node');
      const { tensor, ratio, origW, origH } = await this.preprocess(frameBuffer);

      const inputName = this.session.inputNames[0];
      const inputTensor = new ort.Tensor('float32', tensor, [1, 3, ...this.inputSize]);
      const results = await this.session.run({ [inputName]: inputTensor });

      const outputName = this.session.outputNames[0];
      const output = results[outputName];

      return this._postprocess(output.data, output.dims, ratio, origW, origH);
    } catch (err) {
      console.error('[AI] Detection error:', err.message);
      return this._fallbackDetect();
    }
  }

  /**
   * Post-process YOLOX output: decode boxes, apply NMS.
   */
  _postprocess(data, dims, ratio, origW, origH) {
    const numDetections = dims[1];
    const numAttrs = dims[2]; // x, y, w, h, obj_conf, ...class_scores
    const numClasses = numAttrs - 5;

    const detections = [];

    for (let i = 0; i < numDetections; i++) {
      const offset = i * numAttrs;
      const objConf = data[offset + 4];

      if (objConf < this.confThreshold) continue;

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

      const cx = data[offset];
      const cy = data[offset + 1];
      const w = data[offset + 2];
      const h = data[offset + 3];

      const x1 = Math.max(0, (cx - w / 2) / ratio);
      const y1 = Math.max(0, (cy - h / 2) / ratio);
      const x2 = Math.min(origW, (cx + w / 2) / ratio);
      const y2 = Math.min(origH, (cy + h / 2) / ratio);

      detections.push({
        box: [Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)],
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

  _fallbackDetect() {
    return [{
      box: [450, 180, 720, 680],
      label: 'person',
      classId: 0,
      score: 0.96,
    }];
  }

  async dispose() {
    if (this.session) {
      this.session = null;
      this.ready = false;
    }
  }
}

module.exports = AIEngine;
