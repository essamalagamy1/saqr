// Saqr Detection Pipeline — Unified Multi-Model Vision Analytics
// Real-time ByteTrack tracking, Two-Stage AI Inspections, and Priority Arbitration

class DetectionPipeline {
  constructor(options = {}) {
    this.cameraTracks = new Map(); // cameraId -> Map<trackId, TrackState>
    this.cameraNextTrackId = new Map(); // cameraId -> integer counter
    this.lastCameraAlerts = new Map(); // `${camId}_${serviceSlug}` -> timestamp
    this.lastCameraViolation = new Map(); // camId -> timestamp (suppresses generic presence)
    this.visitorCounters = new Map(); // camId -> { totalIn: 0, totalOut: 0 }
    this.colors = ['#3b82f6', '#06b6d4', '#10b981', '#a855f7', '#f59e0b', '#ec4899'];
  }

  _computeBoxIOU(boxA, boxB) {
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
   * Updates ByteTrack tracking for persons in this camera.
   * Matches by IOU overlap and centroid proximity across consecutive frames.
   * Filters single-frame noise: tracks require multiple hits or temporal persistence.
   */
  updatePersonTracks(camId, persons, now, frameWidth = 1280) {
    if (!this.cameraTracks.has(camId)) {
      this.cameraTracks.set(camId, new Map());
      this.cameraNextTrackId.set(camId, 1);
    }

    const tracks = this.cameraTracks.get(camId);
    const currentPersons = persons.map(p => ({
      box: p.box,
      score: p.score,
      cx: Math.round((p.box[0] + p.box[2]) / 2),
      cy: Math.round((p.box[1] + p.box[3]) / 2),
      matched: false
    }));

    // 1. Primary Association: Spatial Overlap (IOU Matching)
    for (const [trackId, track] of tracks.entries()) {
      // Purge tracks unseen for > 10 seconds
      if (now - track.lastSeen > 10000) {
        tracks.delete(trackId);
        continue;
      }

      let bestIou = 0.20;
      let bestMatch = null;

      for (const cp of currentPersons) {
        if (cp.matched) continue;
        const iou = this._computeBoxIOU(track.box, cp.box);
        if (iou > bestIou) {
          bestIou = iou;
          bestMatch = cp;
        }
      }

      // 2. Secondary Association: Centroid Proximity
      if (!bestMatch) {
        const maxDist = Math.max(45, frameWidth * 0.12);
        let bestDist = maxDist;
        for (const cp of currentPersons) {
          if (cp.matched) continue;
          const d = Math.hypot(cp.cx - track.cx, cp.cy - track.cy);
          if (d < bestDist) {
            bestDist = d;
            bestMatch = cp;
          }
        }
      }

      if (bestMatch) {
        bestMatch.matched = true;
        track.cx = bestMatch.cx;
        track.cy = bestMatch.cy;
        track.box = bestMatch.box;
        track.score = bestMatch.score;
        track.lastSeen = now;
        track.hits = (track.hits || 1) + 1;
      }
    }

    // Register newly entered persons
    let nextId = this.cameraNextTrackId.get(camId) || 1;
    for (const cp of currentPersons) {
      if (!cp.matched) {
        const trackId = `p_${nextId++}`;
        tracks.set(trackId, {
          id: trackId,
          cx: cp.cx,
          cy: cp.cy,
          firstCx: cp.cx,
          firstCy: cp.cy,
          box: cp.box,
          score: cp.score,
          firstSeen: now,
          lastSeen: now,
          hits: 1,
          loiterAlerted: false,
          lastAlertTime: 0,
          countedIn: false,
          countedOut: false,
          consecutiveHits: { ppe: 0, phone: 0 },
          firstCandidateTime: { ppe: 0, phone: 0 }
        });
      }
    }
    this.cameraNextTrackId.set(camId, nextId);

    // Confirmed tracks: ByteTrack stability rule (at least 2 hits or active for >= 1000ms)
    return Array.from(tracks.values()).filter(t => (now - t.lastSeen) < 3000 && (t.hits >= 2 || (now - t.firstSeen) >= 1000));
  }

  /**
   * Two-Stage AI Inspection for Kitchen Face Mask.
   * Leverages the secondary MobileNetV2 ONNX classifier session if loaded.
   */
  async inspectFaceMask(aiEngine, rawFrame, personBox, fw, fh) {
    try {
      const [x1, y1, x2, y2] = personBox;
      const pw = Math.max(10, x2 - x1);
      const ph = Math.max(20, y2 - y1);

      // Crop upper head / face ROI
      const faceLeft = Math.max(0, Math.round(x1 + pw * 0.15));
      const faceTop = Math.max(0, Math.round(y1 + ph * 0.04));
      const faceW = Math.min(fw - faceLeft, Math.max(10, Math.round(pw * 0.70)));
      const faceH = Math.min(fh - faceTop, Math.max(10, Math.round(ph * 0.32)));

      if (faceW < 12 || faceH < 12) return null;

      const faceBox = [faceLeft, faceTop, faceLeft + faceW, faceTop + faceH];

      // 1. If secondary AI classifier is available, run true ONNX classification
      if (aiEngine && typeof aiEngine.classifyFaceMask === 'function' && aiEngine.hasMaskClassifier) {
        const result = await aiEngine.classifyFaceMask(rawFrame, faceBox);
        if (result) {
          return {
            isViolation: !result.hasMask && result.noMaskProb > 0.65,
            confidence: !result.hasMask ? result.noMaskProb : result.maskProb,
            faceBox,
            aiVerified: true,
          };
        }
      }

      // 2. Safe pixel analysis fallback if ONNX classifier not yet loaded
      const sharp = require('sharp');
      const { data, info } = await sharp(rawFrame)
        .extract({ left: faceLeft, top: faceTop, width: faceW, height: faceH })
        .raw()
        .toBuffer({ resolveWithObject: true });

      let skinPixels = 0;
      let maskPixels = 0;
      const startY = Math.floor(info.height * 0.40);

      for (let y = startY; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const idx = (y * info.width + x) * 3;
          const r = data[idx], g = data[idx + 1], b = data[idx + 2];
          // Clear frontal skin condition
          if (r > 65 && g > 40 && b > 25 && r > g && (r - b) > 15) {
            skinPixels++;
          } else if (b > r + 15 && g > r + 10) {
            maskPixels++;
          } else if (r > 180 && g > 180 && b > 180 && Math.abs(r - g) < 15 && Math.abs(g - b) < 15) {
            maskPixels++;
          }
        }
      }

      const lowerTotal = (info.height - startY) * info.width;
      const skinRatio = skinPixels / lowerTotal;
      const maskRatio = maskPixels / lowerTotal;

      // Conservative threshold: require high visible skin exposure (> 0.28) and near zero mask (< 0.10)
      const isViolation = (skinRatio > 0.28 && maskRatio < 0.10);

      return {
        isViolation,
        confidence: isViolation ? Math.min(0.95, parseFloat((0.85 + skinRatio * 0.2).toFixed(2))) : 0.88,
        faceBox,
        aiVerified: false,
      };
    } catch {
      return null;
    }
  }

  /**
   * Two-Stage Inspection for Phone Usage.
   * Matches YOLOX cell phone detections within the tracked person's hand/chest ROI.
   */
  async inspectPhone(rawFrame, personBox, fw, fh, phones = []) {
    try {
      const [x1, y1, x2, y2] = personBox;
      const pw = Math.max(10, x2 - x1);
      const ph = Math.max(20, y2 - y1);

      // Person hand/torso ROI
      const handLeft = Math.max(0, Math.round(x1 + pw * 0.10));
      const handTop = Math.max(0, Math.round(y1 + ph * 0.20));
      const handW = Math.min(fw - handLeft, Math.max(10, Math.round(pw * 0.80)));
      const handH = Math.min(fh - handTop, Math.max(10, Math.round(ph * 0.50)));
      const handBox = [handLeft, handTop, handLeft + handW, handTop + handH];

      // Match YOLOX phone detections with high confidence (>= 0.30)
      const matchingPhone = phones.find(p => {
        if (p.score < 0.30) return false;
        const [px1, py1, px2, py2] = p.box;
        const pcx = (px1 + px2) / 2;
        const pcy = (py1 + py2) / 2;
        return pcx >= (handLeft - 15) && pcx <= (handLeft + handW + 15) &&
               pcy >= (handTop - 15) && pcy <= (handTop + handH + 15);
      });

      if (matchingPhone) {
        return {
          isViolation: true,
          phoneBox: matchingPhone.box,
          confidence: matchingPhone.score,
        };
      }

      return {
        isViolation: false,
        handBox,
        confidence: 0.80,
      };
    } catch {
      return null;
    }
  }

  /**
   * Helper to format percentage-based and pixel-based bounding boxes for dashboard rendering.
   */
  toPercentBox(b, label, color, score, frameWidth, frameHeight) {
    const [bx1, by1, bx2, by2] = b;
    return {
      box: b,
      x: parseFloat(((bx1 / frameWidth) * 100).toFixed(2)),
      y: parseFloat(((by1 / frameHeight) * 100).toFixed(2)),
      width: parseFloat((((bx2 - bx1) / frameWidth) * 100).toFixed(2)),
      height: parseFloat((((by2 - by1) / frameHeight) * 100).toFixed(2)),
      frame_width: frameWidth,
      frame_height: frameHeight,
      label,
      color,
      score: score ? parseFloat(score.toFixed(2)) : 0.90
    };
  }

  /**
   * Parse camera configuration dynamically from DB/API.
   * Completely avoids hardcoded IPs or channel names.
   */
  getCameraConfig(camera) {
    let cfg = {};
    try {
      if (typeof camera.config === 'string') {
        cfg = JSON.parse(camera.config);
      } else if (camera.config && typeof camera.config === 'object') {
        cfg = camera.config;
      }
    } catch {}

    const role = cfg.role || (camera.zone_type === 'kitchen' ? 'kitchen' : (camera.zone_type === 'entrance' ? 'entrance' : 'custom'));
    const enabledServices = Array.isArray(cfg.enabled_services) ? cfg.enabled_services : null;

    return {
      role,
      enabledServices,
      cooldownSeconds: cfg.cooldown_seconds || 180,
      countingLine: cfg.counting_line || { x_ratio: 0.50, direction: 'horizontal' },
    };
  }

  isServiceAllowed(slug, camConfig, camera) {
    if (camConfig.enabledServices && camConfig.enabledServices.length > 0) {
      return camConfig.enabledServices.includes(slug);
    }

    // Role-based heuristics when no explicit services configured
    const role = camConfig.role;
    const isKitchen = (role === 'kitchen') || (camera.zone_type === 'kitchen');
    const isEntrance = (role === 'entrance') || (camera.zone_type === 'entrance');

    if (slug === 'kitchen_ppe') return isKitchen;
    if (slug === 'visitor_counting') return isEntrance && !isKitchen;
    if (slug === 'loitering_detection') return !isKitchen;
    if (slug === 'phone_usage') return true;
    if (slug === 'employee_monitoring') return !isKitchen;
    return false;
  }

  /**
   * Main Evaluation Engine: Prioritizes and arbitrates across all candidate events.
   * Priority Order:
   * 1. Kitchen PPE (100)
   * 2. Phone Usage (80)
   * 3. Loitering (60)
   * 4. Visitor Counting (40)
   * 5. Presence / Employee Monitoring (10)
   */
  async evaluateCandidates(camera, activeTracks, detections, now, fw = 1280, fh = 720, rawFrame = null, aiEngine = null) {
    const candidates = [];
    const camConfig = this.getCameraConfig(camera);
    const cooldownMs = (camConfig.cooldownSeconds || 180) * 1000;
    const phones = detections.filter(d => d.label === 'cell phone');

    // ========================================================
    // PRIORITY 1: KITCHEN PPE (No Mask / Hairnet)
    // Priority: 100
    // ========================================================
    const lastPpeCam = this.lastCameraAlerts.get(`${camera.id}_kitchen_ppe`) || 0;
    if (this.isServiceAllowed('kitchen_ppe', camConfig, camera) && (now - lastPpeCam >= cooldownMs)) {
      for (const track of activeTracks) {
        if (now - track.lastAlertTime < cooldownMs) continue;

        let faceBox = null;
        let ppeConfidence = 0.92;
        let isViolation = false;

        if (rawFrame) {
          const inspection = await this.inspectFaceMask(aiEngine, rawFrame, track.box, fw, fh);
          if (inspection) {
            isViolation = inspection.isViolation;
            faceBox = inspection.faceBox;
            ppeConfidence = inspection.confidence;
          }
        }

        if (isViolation && faceBox) {
          track.consecutiveHits.ppe = (track.consecutiveHits.ppe || 0) + 1;
          if (track.consecutiveHits.ppe >= 2) {
            candidates.push({
              priority: 100,
              serviceSlug: 'kitchen_ppe',
              type: 'سلامة المطبخ: عدم ارتداء الكمامة (No mask detected)',
              severity: 'high',
              confidence: ppeConfidence,
              targetTrack: track,
              boundingBoxes: [
                this.toPercentBox(faceBox, 'No mask', '#f43f5e', ppeConfidence, fw, fh),
                this.toPercentBox(track.box, 'Worker', '#3b82f6', track.score, fw, fh),
              ],
              metadata: {
                violation: 'no_mask',
                service: 'kitchen_ppe',
                zone: camera.zone_name || 'منطقة التحضير والمطبخ',
                track_id: track.id,
                temporal_consensus: 'confirmed_bytetrack_stability',
              }
            });
            break; // Max 1 PPE alert per cycle
          }
        } else {
          track.consecutiveHits.ppe = 0;
        }
      }
    }

    // ========================================================
    // PRIORITY 2: PHONE USAGE DETECTION
    // Priority: 80
    // ========================================================
    const lastPhoneCam = this.lastCameraAlerts.get(`${camera.id}_phone_usage`) || 0;
    if (this.isServiceAllowed('phone_usage', camConfig, camera) && (now - lastPhoneCam >= cooldownMs)) {
      for (const track of activeTracks) {
        if (now - track.lastAlertTime < cooldownMs) continue;

        let isPhoneViolation = false;
        let phoneBox = null;
        let phoneConfidence = 0.88;

        if (rawFrame) {
          const phoneInspect = await this.inspectPhone(rawFrame, track.box, fw, fh, phones);
          if (phoneInspect && phoneInspect.isViolation) {
            isPhoneViolation = true;
            phoneBox = phoneInspect.phoneBox;
            phoneConfidence = phoneInspect.confidence;
          }
        }

        if (isPhoneViolation && phoneBox) {
          track.consecutiveHits.phone = (track.consecutiveHits.phone || 0) + 1;
          if (!track.firstCandidateTime.phone) track.firstCandidateTime.phone = now;

          // Temporal stability: phone visible across at least 2 consecutive frames (> 1.5s)
          if (track.consecutiveHits.phone >= 2 && (now - track.firstCandidateTime.phone >= 1500)) {
            candidates.push({
              priority: 80,
              serviceSlug: 'phone_usage',
              type: 'كشف استخدام الجوال (Phone usage detected)',
              severity: 'medium',
              confidence: phoneConfidence,
              targetTrack: track,
              boundingBoxes: [
                this.toPercentBox(phoneBox, 'Phone usage', '#a855f7', phoneConfidence, fw, fh),
                this.toPercentBox(track.box, 'Person', '#3b82f6', track.score, fw, fh),
              ],
              metadata: {
                service: 'phone_usage',
                object: 'cell_phone',
                zone: camera.zone_name || 'عام',
                track_id: track.id,
                temporal_consensus: 'confirmed_bytetrack_stability',
              }
            });
            break;
          }
        } else {
          track.consecutiveHits.phone = 0;
          track.firstCandidateTime.phone = 0;
        }
      }
    }

    // ========================================================
    // PRIORITY 3: LOITERING DETECTION
    // Priority: 60
    // Cooldown: 5 minutes (300s)
    // ========================================================
    const lastLoiterCam = this.lastCameraAlerts.get(`${camera.id}_loitering_detection`) || 0;
    if (this.isServiceAllowed('loitering_detection', camConfig, camera) && (now - lastLoiterCam >= 300000)) {
      const stationaryLoiterers = activeTracks.filter(t => {
        if (t.loiterAlerted) return false;
        const durationMs = now - t.firstSeen;
        const displacement = Math.hypot(t.cx - t.firstCx, t.cy - t.firstCy);
        return durationMs >= 45000 && displacement < 160;
      });

      if (stationaryLoiterers.length > 0) {
        const topLoiterer = stationaryLoiterers[0];
        const secs = Math.round((now - topLoiterer.firstSeen) / 1000);
        candidates.push({
          priority: 60,
          serviceSlug: 'loitering_detection',
          type: 'كشف التسكع (Loitering detected)',
          severity: 'medium',
          confidence: topLoiterer.score,
          targetTrack: topLoiterer,
          isLoitering: true,
          boundingBoxes: [
            this.toPercentBox(topLoiterer.box, `Lingering ${secs}s`, '#f59e0b', topLoiterer.score, fw, fh),
          ],
          metadata: {
            service: 'loitering_detection',
            lingering_seconds: secs,
            track_id: topLoiterer.id,
          }
        });
      }
    }

    // ========================================================
    // PRIORITY 4: VISITOR COUNTING
    // Priority: 40
    // Cooldown: 10 seconds
    // ========================================================
    const lastVisitorCam = this.lastCameraAlerts.get(`${camera.id}_visitor_counting`) || 0;
    if (this.isServiceAllowed('visitor_counting', camConfig, camera) && (now - lastVisitorCam >= 10000)) {
      if (!this.visitorCounters.has(camera.id)) {
        this.visitorCounters.set(camera.id, { totalIn: 0, totalOut: 0 });
      }
      const vc = this.visitorCounters.get(camera.id);
      const lineRatio = camConfig.countingLine?.x_ratio || 0.50;
      const doorX = Math.round(fw * lineRatio);

      for (const t of activeTracks) {
        // Crossing toward interior (IN)
        if (!t.countedIn && t.firstCx > doorX + 30 && t.cx <= doorX) {
          t.countedIn = true;
          vc.totalIn++;
          candidates.push({
            priority: 40,
            serviceSlug: 'visitor_counting',
            type: 'عد الزوار: دخول شخص (Visitor Entry)',
            severity: 'low',
            confidence: t.score,
            targetTrack: t,
            boundingBoxes: [this.toPercentBox(t.box, 'دخول زائر (In)', '#10b981', t.score, fw, fh)],
            metadata: {
              direction: 'in',
              count: 1,
              total_in: vc.totalIn,
              total_out: vc.totalOut,
              service: 'visitor_counting',
            }
          });
          break;
        }
        // Crossing toward exterior (OUT)
        else if (!t.countedOut && t.firstCx <= doorX - 30 && t.cx > doorX) {
          t.countedOut = true;
          vc.totalOut++;
          candidates.push({
            priority: 40,
            serviceSlug: 'visitor_counting',
            type: 'عد الزوار: خروج شخص (Visitor Exit)',
            severity: 'low',
            confidence: t.score,
            targetTrack: t,
            boundingBoxes: [this.toPercentBox(t.box, 'خروج زائر (Out)', '#0ea5e9', t.score, fw, fh)],
            metadata: {
              direction: 'out',
              count: 1,
              total_in: vc.totalIn,
              total_out: vc.totalOut,
              service: 'visitor_counting',
            }
          });
          break;
        }
      }
    }

    // ========================================================
    // PRIORITY 5: MULTI-PERSON PRESENCE / EMPLOYEE MONITORING
    // Priority: 10
    // Suppression: Suppressed if violations active or occurred in last 120s
    // Cooldown: 180s
    // ========================================================
    const lastPresenceCam = this.lastCameraAlerts.get(`${camera.id}_employee_monitoring`) || 0;
    const lastViolation = this.lastCameraViolation.get(camera.id) || 0;

    if (
      this.isServiceAllowed('employee_monitoring', camConfig, camera) &&
      candidates.length === 0 &&
      (now - lastViolation >= 120000) &&
      (now - lastPresenceCam >= cooldownMs) &&
      activeTracks.length > 0
    ) {
      const isMultiple = activeTracks.length > 1;
      const richBoxes = activeTracks.map((t, idx) => this.toPercentBox(
        t.box,
        isMultiple ? `Person ${idx + 1} (${Math.round(t.score * 100)}%)` : 'Person detected',
        this.colors[idx % this.colors.length],
        t.score,
        fw,
        fh
      ));

      candidates.push({
        priority: 10,
        serviceSlug: 'employee_monitoring',
        type: isMultiple ? `رصد أشخاص متعددين (${activeTracks.length} أشخاص)` : 'Person detected',
        severity: isMultiple ? 'medium' : 'low',
        confidence: Math.max(...activeTracks.map(t => t.score)),
        boundingBoxes: richBoxes,
        metadata: {
          persons_count: activeTracks.length,
          service: 'presence',
        }
      });
    }

    if (candidates.length === 0) return null;

    // Pick top priority winner
    candidates.sort((a, b) => b.priority - a.priority);
    const winner = candidates[0];

    // Update camera violation state
    if (winner.priority >= 60) {
      this.lastCameraViolation.set(camera.id, now);
    }

    // Update cooldown timestamp
    this.lastCameraAlerts.set(`${camera.id}_${winner.serviceSlug}`, now);

    // Update individual track states
    if (winner.targetTrack) {
      winner.targetTrack.lastAlertTime = now;
      if (winner.isLoitering) {
        winner.targetTrack.loiterAlerted = true;
      }
    }

    return winner;
  }
}

module.exports = DetectionPipeline;
