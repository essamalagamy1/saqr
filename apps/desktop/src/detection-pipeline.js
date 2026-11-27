// Saqr Detection Pipeline — Unified Multi-Model Vision Pipeline
// Handles arbitration and event synthesis for:
// 1. Face Mask (Compliant vs No Mask vs Incorrect Mask)
// 2. Gloves & Bare Hand (Disposable Gloves vs Bare Hands)
// 3. Mobile Phone Usage (Handheld Phone in work area)
// Strictly eliminates all generic presence/loitering noise as requested.

const { MultiCameraTracker } = require('./tracker');

class DetectionPipeline {
  constructor() {
    this.tracker = new MultiCameraTracker();
    this.lastAlerts = new Map(); // `${camId}_t${trackId}_${violationType}` -> timestamp
    this.recentHits = new Map(); // `${camId}_t${trackId}_${violationType}` -> [{ ts, cx, cy, score }]
    this.lastAlertSpots = new Map(); // `${camId}_t${trackId}_${violationType}` -> { ts, cx, cy }
    this.defaultCooldownMs = 45000; // 45s default cooldown between repeated alerts
    this.staticSpotCooldownMs = 120000; // 120s cooldown when repeating on exact same static spot
    this.consensusWindowMs = 35000; // 35s window for multi-frame temporal verification across multi-camera sweeps
  }

  /**
   * Match a PPE/violation box to the best active tracked person ID in the frame.
   */
  _matchTrackId(box, trackedPersons) {
    if (!box || !trackedPersons || trackedPersons.length === 0) return null;
    const cx = (box[0] + box[2]) / 2;
    const cy = (box[1] + box[3]) / 2;

    let bestId = null;
    let bestDist = Infinity;
    for (const p of trackedPersons) {
      const [px1, py1, px2, py2] = p.box;
      const pw = px2 - px1;
      const ph = py2 - py1;
      if (cx >= px1 - pw * 0.12 && cx <= px2 + pw * 0.12 && cy >= py1 - ph * 0.12 && cy <= py2 + ph * 0.12) {
        const pcx = (px1 + px2) / 2;
        const pcy = (py1 + py2) / 2;
        const dist = Math.hypot(cx - pcx, cy - pcy);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = p.trackId;
        }
      }
    }
    return bestId;
  }

  /**
   * Group violations by matched trackId so each tracked person has independent
   * temporal verification and cooldown state.
   */
  _groupByTrack(violations, trackedPersons) {
    if (!violations || violations.length === 0) {
      return [];
    }
    if (!trackedPersons || trackedPersons.length === 0) {
      return [{ trackId: null, items: violations }];
    }
    const groups = new Map();
    for (const v of violations) {
      const tid = this._matchTrackId(v.box, trackedPersons);
      const key = tid === null ? 'untracked' : String(tid);
      if (!groups.has(key)) groups.set(key, { trackId: tid, items: [] });
      groups.get(key).items.push(v);
    }
    return Array.from(groups.values());
  }

  /**
   * Verify that a violation persists across >= 2 recent frames (or has very high confidence >= 0.72)
   * and apply stricter cooldown if it keeps firing on the exact same stationary spot.
   */
  _shouldEmitWithVerification(alertKey, box, score, now, cooldownMs) {
    const cx = box ? ((box[0] + box[2]) / 2) : 0;
    const cy = box ? ((box[1] + box[3]) / 2) : 0;

    // 1. Temporal Consensus Verification
    const history = (this.recentHits.get(alertKey) || []).filter(h => now - h.ts <= this.consensusWindowMs);
    history.push({ ts: now, cx, cy, score });
    this.recentHits.set(alertKey, history);

    if (score < 0.72 && history.length < 2) {
      return false;
    }

    // 2. Cooldown & Static-Spot Anti-Loop Check
    const lastSpot = this.lastAlertSpots.get(alertKey);
    const lastAlert = this.lastAlerts.get(alertKey);
    let effectiveCooldown = cooldownMs;

    if (lastSpot && box) {
      const movedPx = Math.hypot(cx - lastSpot.cx, cy - lastSpot.cy);
      if (movedPx < 25) {
        effectiveCooldown = Math.max(cooldownMs, this.staticSpotCooldownMs);
      }
    }

    if (lastAlert !== undefined && (now - lastAlert < effectiveCooldown)) {
      return false;
    }

    this.lastAlerts.set(alertKey, now);
    this.lastAlertSpots.set(alertKey, { ts: now, cx, cy });
    return true;
  }

  toPercentBox(box, label, color, score, frameWidth, frameHeight) {
    const [bx1, by1, bx2, by2] = box;
    return {
      box,
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
   * Process frame detections and arbitrate candidates based on camera active models.
   * Multiple models can run and alert if violations occur.
   */
  evaluateDetections(camera, detections, now, fw = 1280, fh = 720, persons = []) {
    const trackedPersons = (persons && persons.length > 0)
      ? this.tracker.update(camera.id, persons, now)
      : [];

    if (!detections || detections.length === 0) return [];

    const activeModels = camera.activeModels || [];
    if (activeModels.length === 0) return [];

    const candidates = [];
    const cooldown = (camera.cooldown_seconds ? camera.cooldown_seconds * 1000 : this.defaultCooldownMs);
    const keyScope = (tid, suffix) => (tid !== null ? `${camera.id}_t${tid}_${suffix}` : `${camera.id}_${suffix}`);

    // 1. Check Face Mask Violations (NO_MASK or INCORRECT_MASK)
    if (activeModels.includes('face_mask')) {
      const maskViolations = detections.filter(d => d.model === 'face_mask' && d.isViolation);
      for (const { trackId, items } of this._groupByTrack(maskViolations, trackedPersons)) {
        const topViolation = items[0];
        const alertKey = keyScope(trackId, `face_mask_${topViolation.status}`);

        if (this._shouldEmitWithVerification(alertKey, topViolation.box, topViolation.score, now, cooldown)) {
          const typeName = topViolation.status === 'NO_MASK'
            ? 'سلامة الغذاء: عدم ارتداء الكمامة في بيئة العمل'
            : 'سلامة الغذاء: ارتداء الكمامة بطريقة غير صحيحة';

          candidates.push({
            serviceSlug: 'kitchen_ppe',
            type: typeName,
            severity: topViolation.status === 'NO_MASK' ? 'high' : 'medium',
            confidence: topViolation.score,
            boundingBoxes: items.slice(0, 2).map(v =>
              this.toPercentBox(v.box, v.label, v.color, v.score, fw, fh)
            ),
            metadata: {
              model: 'face_mask',
              status: topViolation.status,
              track_id: trackId,
              zone: camera.zone_name || 'عام',
              count: items.length
            }
          });
        }
      }
    }

    // 2. Check Gloves & Bare Hand Violations (BARE_HAND_VIOLATION)
    if (activeModels.includes('gloves')) {
      const bareHands = detections.filter(d => d.model === 'gloves' && d.status === 'BARE_HAND_VIOLATION');
      for (const { trackId, items } of this._groupByTrack(bareHands, trackedPersons)) {
        const topHands = items.slice(0, 2); // At most 2 hands per person event
        const topBareHand = topHands[0];
        const alertKey = keyScope(trackId, 'gloves_bare_hand');

        if (this._shouldEmitWithVerification(alertKey, topBareHand.box, topBareHand.score, now, cooldown)) {
          candidates.push({
            serviceSlug: 'kitchen_ppe',
            type: 'سلامة الغذاء: لمس الأغذية بدون قفازات (يد مكشوفة)',
            severity: 'high',
            confidence: topBareHand.score,
            boundingBoxes: topHands.map(h =>
              this.toPercentBox(h.box, h.label || 'يد بدون قفازات', h.color, h.score, fw, fh)
            ),
            metadata: {
              model: 'gloves',
              status: 'BARE_HAND_VIOLATION',
              track_id: trackId,
              zone: camera.zone_name || 'منطقة التحضير والأغذية',
              count: topHands.length
            }
          });
        }
      }
    }

    // 3. Check Mobile Phone Usage (PHONE_DETECTED)
    if (activeModels.includes('phone')) {
      const phones = detections.filter(d => d.model === 'phone' && d.status === 'PHONE_DETECTED');
      for (const { trackId, items } of this._groupByTrack(phones, trackedPersons)) {
        const topPhone = items[0];
        const alertKey = keyScope(trackId, 'phone_usage');

        if (this._shouldEmitWithVerification(alertKey, topPhone.box, topPhone.score, now, cooldown)) {
          candidates.push({
            serviceSlug: 'phone_usage',
            type: 'انشغال العامل: استخدام الهاتف المحمول أثناء العمل',
            severity: 'medium',
            confidence: topPhone.score,
            boundingBoxes: items.slice(0, 2).map(p =>
              this.toPercentBox(p.box, p.label, p.color, p.score, fw, fh)
            ),
            metadata: {
              model: 'phone',
              status: 'PHONE_DETECTED',
              track_id: trackId,
              zone: camera.zone_name || 'عام',
              count: items.length
            }
          });
        }
      }
    }

    return candidates;
  }
}

module.exports = DetectionPipeline;
