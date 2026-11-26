// Saqr Edge Agent — Multi-Model AI Detection Engine (YOLO26 ONNX)
// Handles 3 Independent Models: Face Mask, Gloves & Bare Hand, and Mobile Phone.
// Zero Python runtime dependency — Blazing fast ONNX Runtime with DirectML/CPU support.

const path = require('path');
const fs = require('fs');
const os = require('os');

const MODEL_SPECS = {
  coco: {
    filename: 'coco_yolo26n.onnx',
    numClasses: 80,
    auxiliary: true,
    personClassId: 0,
    phoneClassId: 67,
    defaultConf: 0.25,
    phoneConf: 0.13
  },
  face_mask: {
    filename: 'face_mask.onnx',
    numClasses: 3,
    classes: ['with_mask', 'without_mask', 'mask_weared_incorrect'],
    statusMap: {
      with_mask: { status: 'COMPLIANT', label: 'كمامة مطابقة', isViolation: false, color: '#10b981' },
      without_mask: { status: 'NO_MASK', label: 'بدون كمامة', isViolation: true, color: '#ef4444' },
      mask_weared_incorrect: { status: 'INCORRECT_MASK', label: 'ارتداء غير صحيح', isViolation: true, color: '#f59e0b' }
    },
    defaultConf: 0.45
  },
  gloves: {
    filename: 'gloves.onnx',
    numClasses: 2,
    classes: ['gloves', 'bare_hand'],
    statusMap: {
      gloves: { status: 'GLOVES_COMPLIANT', label: 'قفازات', isViolation: false, color: '#10b981' },
      bare_hand: { status: 'BARE_HAND_VIOLATION', label: 'يد بدون قفازات', isViolation: true, color: '#ef4444' }
    },
    defaultConf: 0.45
  },
  phone: {
    filename: 'phone.onnx',
    numClasses: 1,
    classes: ['cell_phone'],
    statusMap: {
      cell_phone: { status: 'PHONE_DETECTED', label: 'استخدام هاتف', isViolation: true, color: '#a855f7' }
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
    this.sessionMtimes = {}; // modelKey -> file mtimeMs
    this.sessionPaths = {}; // modelKey -> resolved path
    this.manifest = null;
    this.manifestMtime = 0;
    this.ready = false;
  }

  _resolveModelPath(filename) {
    const folderMap = {
      'face_mask.onnx': 'face_mask',
      'gloves.onnx': 'gloves',
      'phone.onnx': 'phone_detection'
    };
    const cvDir = folderMap[filename] || filename.replace('.onnx', '');
    const candidates = [
      path.join(__dirname, '..', 'models', filename),
      path.join(process.resourcesPath || '', 'models', filename),
      path.join(process.resourcesPath || '', 'app.asar.unpacked', 'models', filename),
      path.join(process.cwd(), 'models', filename),
      path.join(__dirname, '..', '..', '..', 'computer-vision', cvDir, 'weights', 'best.onnx')
    ];

    for (const p of candidates) {
      if (p && fs.existsSync(p)) {
        return p;
      }
    }
    return null;
  }

  _loadManifest() {
    const manifestPath = path.join(__dirname, '..', 'models', 'studio_manifest.json');
    try {
      if (!fs.existsSync(manifestPath)) {
        this.manifest = null;
        this.manifestMtime = 0;
        return null;
      }
      const stat = fs.statSync(manifestPath);
      if (stat.mtimeMs !== this.manifestMtime) {
        this.manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        this.manifestMtime = stat.mtimeMs;
      }
    } catch {
      // Ignore malformed/in-flight manifest read
    }
    return this.manifest;
  }

  async _createSessionFromFile(ort, resolved, providers) {
    const modelBuffer = fs.readFileSync(resolved);
    const cpuCount = os.cpus().length || 4;
    const intraThreads = Math.max(2, Math.min(4, Math.floor(cpuCount / 2)));
    const sessionOpts = {
      executionProviders: providers,
      graphOptimizationLevel: 'all',
      intraOpNumThreads: intraThreads,
      interOpNumThreads: 1,
      enableMemPattern: true,
      enableMemReuse: true,
    };
    const cpuOpts = {
      ...sessionOpts,
      executionProviders: ['cpu'],
    };

    try {
      const session = await ort.InferenceSession.create(modelBuffer, sessionOpts);
      return { session, sizeBytes: modelBuffer.length };
    } catch {
      try {
        const session = await ort.InferenceSession.create(modelBuffer, cpuOpts);
        return { session, sizeBytes: modelBuffer.length };
      } catch {
        const session = await ort.InferenceSession.create(resolved, cpuOpts);
        return { session, sizeBytes: modelBuffer.length };
      }
    }
  }

  /**
   * Initializes ONNX runtime sessions for all models.
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
    this._loadManifest();

    for (const [key, spec] of Object.entries(MODEL_SPECS)) {
      const resolved = this._resolveModelPath(spec.filename);
      if (!resolved) {
        console.warn(`[AI] Model ${spec.filename} not found in paths. Skipping.`);
        continue;
      }

      try {
        const stat = fs.statSync(resolved);
        const { session, sizeBytes } = await this._createSessionFromFile(ort, resolved, providers);
        this.sessions[key] = session;
        this.sessionPaths[key] = resolved;
        this.sessionMtimes[key] = stat.mtimeMs;
        console.log(`[AI] 🚀 Loaded ${key} model from Buffer (${(sizeBytes / 1024 / 1024).toFixed(1)}MB)`);
      } catch (err) {
        console.error(`[AI] Failed to load ${key}:`, err.message);
      }
    }

    this.ready = Object.keys(this.sessions).length > 0;
  }

  /**
   * Checks model mtimes & studio_manifest.json and atomically hot-reloads any updated .onnx model.
   */
  async reloadIfUpdated() {
    if (!this.ready) return;
    let ort;
    try {
      ort = require('onnxruntime-node');
    } catch {
      return;
    }

    const providers = process.platform === 'win32' ? ['dml', 'cpu'] : ['cpu'];
    this._loadManifest();

    for (const [key, spec] of Object.entries(MODEL_SPECS)) {
      const resolved = this.sessionPaths[key] || this._resolveModelPath(spec.filename);
      if (!resolved || !fs.existsSync(resolved)) continue;
      try {
        const stat = fs.statSync(resolved);
        if (this.sessionMtimes[key] && stat.mtimeMs <= this.sessionMtimes[key]) {
          continue;
        }
        const prevSession = this.sessions[key];
        const { session, sizeBytes } = await this._createSessionFromFile(ort, resolved, providers);
        this.sessions[key] = session;
        this.sessionPaths[key] = resolved;
        this.sessionMtimes[key] = stat.mtimeMs;
        if (prevSession && typeof prevSession.release === 'function') {
          try { await prevSession.release(); } catch {}
        }
        console.log(`[AI] 🔄 Hot-reloaded updated ${key} model (${(sizeBytes / 1024 / 1024).toFixed(1)}MB)`);
      } catch (err) {
        console.warn(`[AI] Hot-reload failed for ${key}:`, err.message);
      }
    }
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
   * Checks for skin-tone pixels inside a bounding box region.
   * Used to verify that a face_mask detection is on an actual human face, not a food tray or surface.
   * Returns { hasSkin: bool, skinRatio: float }
   */
  _checkSkinPresence(rawRgb, scale, padX, padY, box) {
    if (!rawRgb) return { hasSkin: false, skinRatio: 0 };
    const [x1, y1, x2, y2] = box;

    const gx1 = Math.max(0, Math.min(639, Math.round(x1 * scale + padX)));
    const gy1 = Math.max(0, Math.min(639, Math.round(y1 * scale + padY)));
    const gx2 = Math.max(0, Math.min(639, Math.round(x2 * scale + padX)));
    const gy2 = Math.max(0, Math.min(639, Math.round(y2 * scale + padY)));

    if ((gx2 - gx1) < 4 || (gy2 - gy1) < 4) return { hasSkin: false, skinRatio: 0 };

    let total = 0;
    let skinPx = 0;

    for (let y = gy1; y <= gy2; y++) {
      for (let x = gx1; x <= gx2; x++) {
        const idx = (y * 640 + x) * 3;
        const r = rawRgb[idx];
        const g = rawRgb[idx + 1];
        const b = rawRgb[idx + 2];
        total++;
        // Skin tone heuristic: warm, R > G > B, not too dark, not too bright, not gray
        if (r > 60 && g > 35 && b > 15 && r > g && r > b && (r - b) > 15 && r < 240 && (r - g) < 90) {
          skinPx++;
        }
      }
    }

    const skinRatio = total > 0 ? (skinPx / total) : 0;
    return { hasSkin: skinRatio >= 0.07, skinRatio };
  }

  /**
   * Chromatic Glove vs Bare-Skin Analyzer.
   * Prevents false bare-hand alerts on blue/cyan/black nitrile gloves or non-skin kitchen surfaces.
   */
  _analyzeGloveColor(rawRgb, scale, padX, padY, box) {
    if (!rawRgb) return null;
    const [x1, y1, x2, y2] = box;

    const gx1 = Math.max(0, Math.min(639, Math.round(x1 * scale + padX)));
    const gy1 = Math.max(0, Math.min(639, Math.round(y1 * scale + padY)));
    const gx2 = Math.max(0, Math.min(639, Math.round(x2 * scale + padX)));
    const gy2 = Math.max(0, Math.min(639, Math.round(y2 * scale + padY)));

    const bw = gx2 - gx1;
    const bh = gy2 - gy1;
    if (bw < 4 || bh < 4) return null;

    let total = 0;
    let blueGlovePx = 0;
    let blackGlovePx = 0;
    let skinPx = 0;

    for (let y = gy1; y <= gy2; y++) {
      for (let x = gx1; x <= gx2; x++) {
        const idx = (y * 640 + x) * 3;
        const r = rawRgb[idx];
        const g = rawRgb[idx + 1];
        const b = rawRgb[idx + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        total++;

        // Disposable blue/cyan/teal gloves
        if (b > 65 && (b - r) > 16 && b >= g - 12) {
          blueGlovePx++;
        } else if (lum < 52 && Math.max(r, g, b) - Math.min(r, g, b) < 22) {
          blackGlovePx++;
        } else if (r > 80 && g > 45 && b > 25 && r > g && (r - b) > 12) {
          skinPx++;
        }
      }
    }

    if (total === 0) return null;
    const blueRatio = blueGlovePx / total;
    const blackRatio = blackGlovePx / total;
    const skinRatio = skinPx / total;

    return {
      blueRatio,
      blackRatio,
      skinRatio,
      hasDisposableGloves: blueRatio >= 0.16 || blackRatio >= 0.48
    };
  }

  /**
   * Non-Maximum Suppression (NMS) for candidate bounding boxes.
   * Supports optional spatial center-distance suppression to eliminate adjacent duplicates.
   */
  _applyNms(boxes, iouThreshold = 0.45, minCenterDist = 0) {
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
      const cxA = (x1A + x2A) / 2;
      const cyA = (y1A + y2A) / 2;

      for (let j = i + 1; j < boxes.length; j++) {
        if (suppressed[j]) continue;
        const b2 = boxes[j];
        const [x1B, y1B, x2B, y2B] = b2.box;

        if (minCenterDist > 0) {
          const cxB = (x1B + x2B) / 2;
          const cyB = (y1B + y2B) / 2;
          if (Math.hypot(cxA - cxB, cyA - cyB) < minCenterDist) {
            suppressed[j] = 1;
            continue;
          }
        }

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
   * Verifies that a detection box belongs to an actual detected person in the frame.
   * mode: 'face' (upper/head ROI: top 42% of person box),
   *       'hand' / 'phone' (body/hand ROI: excludes top 14% crown/hair/hat).
   */
  _isInsidePersonRegion(box, persons, mode = 'any') {
    if (!persons || persons.length === 0) return false;
    const [x1, y1, x2, y2] = box;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;

    return persons.some(p => {
      const [px1, py1, px2, py2] = p.box;
      const pw = px2 - px1;
      const ph = py2 - py1;
      if (pw <= 0 || ph <= 0) return false;

      if (mode === 'face') {
        const horizMargin = pw * 0.06;
        const topMargin = ph * 0.10;
        return (
          cx >= (px1 + horizMargin) &&
          cx <= (px2 - horizMargin) &&
          cy >= (py1 - topMargin) &&
          cy <= (py1 + ph * 0.42)
        );
      }

      const marginX = pw * 0.10;
      const marginY = ph * 0.08;
      return (
        cx >= (px1 - marginX) &&
        cx <= (px2 + marginX) &&
        cy >= (py1 + ph * 0.14) &&
        cy <= (py2 + marginY)
      );
    });
  }

  /**
   * Extracts COCO persons (class 0) and optionally cell phones (class 67)
   * from yolo26n.onnx output tensor [1, 84, 8400].
   */
  _extractCocoPersonsAndPhones(data, origW, origH, scale, padX, padY, detectPhone) {
    const spec = MODEL_SPECS.coco;
    const personMinConf = spec.defaultConf;
    const phoneMinConf = spec.phoneConf;
    const personCands = [];
    const phoneCands = [];

    for (let i = 0; i < 8400; i++) {
      const pScore = data[(4 + spec.personClassId) * 8400 + i];
      const phScore = detectPhone ? data[(4 + spec.phoneClassId) * 8400 + i] : 0;

      if (pScore < personMinConf && phScore < phoneMinConf) continue;

      const cx = (data[0 * 8400 + i] - padX) / scale;
      const cy = (data[1 * 8400 + i] - padY) / scale;
      const w = data[2 * 8400 + i] / scale;
      const h = data[3 * 8400 + i] / scale;

      const x1 = Math.max(0, Math.min(origW, Math.round(cx - w / 2)));
      const y1 = Math.max(0, Math.min(origH, Math.round(cy - h / 2)));
      const x2 = Math.max(0, Math.min(origW, Math.round(cx + w / 2)));
      const y2 = Math.max(0, Math.min(origH, Math.round(cy + h / 2)));
      const bw = x2 - x1;
      const bh = y2 - y1;
      if (bw < 8 || bh < 8) continue;

      if (pScore >= personMinConf && bw >= 24 && bh >= 40) {
        personCands.push({ score: parseFloat(pScore.toFixed(3)), box: [x1, y1, x2, y2] });
      }

      if (detectPhone && phScore >= phoneMinConf) {
        const areaRatio = (bw * bh) / (origW * origH);
        const wRatio = bw / origW;
        const hRatio = bh / origH;
        if (bw >= 12 && bh >= 12 && bw <= 90 && bh <= 90 && areaRatio <= 0.03 && wRatio <= 0.14 && hRatio <= 0.18) {
          const phoneMeta = MODEL_SPECS.phone.statusMap.cell_phone;
          phoneCands.push({
            model: 'phone',
            rawClass: 'cell_phone',
            label: phoneMeta.label,
            status: phoneMeta.status,
            isViolation: phoneMeta.isViolation,
            color: phoneMeta.color,
            score: parseFloat(phScore.toFixed(3)),
            box: [x1, y1, x2, y2]
          });
        }
      }
    }

    const persons = this._applyNms(personCands, 0.45);
    const phones = this._applyNms(phoneCands, 0.40).filter(ph =>
      this._isInsidePersonRegion(ph.box, persons, 'phone')
    );

    return { persons, phones };
  }

  /**
   * Run inference on a frame with the active models assigned to this camera.
   * activeModels: string[] e.g. ['face_mask', 'gloves', 'phone']
   * options: { rawMode?: boolean, confThreshold?: number }
   */
  async detect(frameBuffer, activeModels = ['face_mask', 'gloves', 'phone'], options = {}) {
    if (!this.ready) {
      await this.init();
    }
    const rawMode = Boolean(options.rawMode);
    if (!frameBuffer || (!rawMode && frameBuffer.length < 5000)) {
      return { detections: [], persons: [], frameWidth: 1280, frameHeight: 720 };
    }

    this._loadManifest();
    const { float32, rawRgb, origW, origH, scale, padX, padY } = await this.preprocess(frameBuffer);
    const ort = require('onnxruntime-node');
    const tensor = new ort.Tensor('float32', float32, [1, 3, 640, 640]);

    const phoneCustomActive = Boolean(this.manifest?.models?.phone?.studioTrained && this.sessions.phone);
    const hasCoco = Boolean(this.sessions.coco);
    const wantsPhone = activeModels.includes('phone');
    const useCocoForPhone = !rawMode && wantsPhone && hasCoco && !phoneCustomActive;

    const modelsToRun = activeModels.filter(m => {
      if (m === 'phone' && useCocoForPhone) return false;
      return Boolean(this.sessions[m]);
    });

    if (!hasCoco && modelsToRun.length === 0) {
      return { detections: [], persons: [], frameWidth: origW, frameHeight: origH };
    }

    let cocoPersons = null;
    const allDetections = [];

    // Step 1: In production mode, run COCO person (+ phone) detector first so empty cameras skip domain models
    if (!rawMode && hasCoco) {
      try {
        const out = await this.sessions.coco.run({ images: tensor });
        const data = out.output0 ? out.output0.data : out[Object.keys(out)[0]].data;
        const { persons, phones } = this._extractCocoPersonsAndPhones(
          data, origW, origH, scale, padX, padY, useCocoForPhone
        );
        cocoPersons = persons;
        if (useCocoForPhone && phones.length > 0) {
          allDetections.push(...phones);
        }
        if (cocoPersons.length === 0) {
          return { detections: [], persons: [], frameWidth: origW, frameHeight: origH };
        }
      } catch (err) {
        console.warn('[AI] Inference error on coco:', err.message);
      }
    }

    const tasks = [];

    // Step 2: Run active custom domain models concurrently
    for (const modelKey of modelsToRun) {
      tasks.push((async () => {
        const session = this.sessions[modelKey];
        const spec = MODEL_SPECS[modelKey];
        let confLimit = options.confThreshold ?? spec.defaultConf ?? this.confThreshold;
        if (!rawMode && modelKey === 'phone' && phoneCustomActive) {
          confLimit = this.manifest?.models?.phone?.conf ?? 0.22;
        }

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

                if (!rawMode) {
                  // Physical CCTV Filter: A phone in a ceiling camera is a small handheld object
                  if (modelKey === 'phone') {
                    if (areaRatio > 0.03 || wRatio > 0.14 || hRatio > 0.18 || bw < 12 || bh < 12 || bw > 90 || bh > 90) {
                      continue;
                    }
                  }

                  // Face mask filter: face box cannot cover more than 20% of the entire camera screen
                  if (modelKey === 'face_mask') {
                    if (areaRatio > 0.20 || wRatio > 0.35 || hRatio > 0.40) {
                      continue;
                    }
                    if (bw < 15 || bh < 15) continue;
                    const faceAspect = bw / bh;
                    if (faceAspect > 2.2 || faceAspect < 0.3) continue;
                  }

                  // Gloves & hand filter: hand in ceiling CCTV cannot be as large as a torso/person
                  if (modelKey === 'gloves') {
                    if (areaRatio > 0.025 || wRatio > 0.14 || hRatio > 0.22 || bw > 85 || bh > 85) {
                      continue;
                    }
                  }
                }

                let rawClass = spec.classes[bestCls];
                let classId = bestCls;
                let meta = spec.statusMap[rawClass] || { status: rawClass, label: rawClass, isViolation: false, color: '#3b82f6' };
                let score = parseFloat(maxScore.toFixed(3));

                if (!rawMode) {
                  // Specialized Black Mask, Black Headwear & Black T-Shirt (Uniform) Validation
                  if (modelKey === 'face_mask') {
                    const skinCheck = this._checkSkinPresence(rawRgb, scale, padX, padY, [x1, y1, x2, y2]);
                    if ((rawClass === 'without_mask' || rawClass === 'mask_weared_incorrect') && !skinCheck.hasSkin) {
                      continue;
                    }

                    const uniform = this._analyzeBlackMaskAndHeadwear(rawRgb, scale, padX, padY, [x1, y1, x2, y2]);
                    const strongWithoutMask = rawClass === 'without_mask' && score >= 0.72;
                    if (uniform && !strongWithoutMask) {
                      if (uniform.hasBlackMask) {
                        rawClass = 'with_mask';
                        classId = 0;
                        let label = 'كمامة صحيحة';
                        if (uniform.hasBlackTshirt && uniform.hasBlackHeadCover) {
                          label = 'طاقم مطابق';
                        } else if (uniform.hasBlackTshirt) {
                          label = 'عامل بزي رسمي + كمامة';
                        } else if (uniform.hasBlackHeadCover) {
                          label = 'كمامة + غطاء رأس';
                        }
                        meta = {
                          status: 'COMPLIANT',
                          label,
                          isViolation: false,
                          color: '#10b981'
                        };
                        score = Math.max(score, 0.94);
                      } else if (rawClass === 'without_mask' || uniform.lowerDarkRatio < 0.22) {
                        if (!skinCheck.hasSkin) continue;
                        rawClass = 'without_mask';
                        classId = 1;
                        meta = {
                          ...spec.statusMap['without_mask'],
                          label: 'بدون كمامة'
                        };
                      }
                    }
                  }

                  // Gloves & Bare Hand Validation
                  if (modelKey === 'gloves') {
                    if (rawClass === 'bare_hand') {
                      const gloveCheck = this._analyzeGloveColor(rawRgb, scale, padX, padY, [x1, y1, x2, y2]);
                      if (gloveCheck && gloveCheck.hasDisposableGloves) {
                        rawClass = 'gloves';
                        classId = 0;
                        meta = {
                          ...spec.statusMap['gloves'],
                          label: 'قفازات'
                        };
                      } else if (gloveCheck && gloveCheck.skinRatio < 0.06 && score < 0.78) {
                        continue;
                      } else {
                        meta = {
                          ...spec.statusMap['bare_hand'],
                          label: 'يد بدون قفازات'
                        };
                      }
                    }
                  }
                }

                candidates.push({
                  model: modelKey,
                  classId,
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

          const nmsIou = (!rawMode && modelKey === 'gloves') ? 0.15 : this.nmsThreshold;
          const minCenterDist = (!rawMode && modelKey === 'gloves') ? 70 : 0;
          const filtered = this._applyNms(candidates, nmsIou, minCenterDist);
          allDetections.push(...filtered);
        } catch (err) {
          console.warn(`[AI] Inference error on ${modelKey}:`, err.message);
        }
      })());
    }

    await Promise.all(tasks);

    // Person-anchored spatial gating in production mode
    const verifiedDetections = (rawMode || cocoPersons === null)
      ? allDetections
      : allDetections.filter(d => {
          if (!d.isViolation) return true;
          if (d.model === 'face_mask') return this._isInsidePersonRegion(d.box, cocoPersons, 'face');
          if (d.model === 'gloves') return this._isInsidePersonRegion(d.box, cocoPersons, 'hand');
          if (d.model === 'phone') return this._isInsidePersonRegion(d.box, cocoPersons, 'phone');
          return true;
        });

    return {
      detections: verifiedDetections,
      persons: cocoPersons || [],
      frameWidth: origW,
      frameHeight: origH
    };
  }
}

module.exports = AIEngine;
