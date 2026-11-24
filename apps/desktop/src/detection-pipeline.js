// Saqr Detection Pipeline — Unified Multi-Model Vision Pipeline
// Handles arbitration and event synthesis for:
// 1. Face Mask (Compliant vs No Mask vs Incorrect Mask)
// 2. Gloves & Bare Hand (Disposable Gloves vs Bare Hands)
// 3. Mobile Phone Usage (Handheld Phone in work area)
// Strictly eliminates all generic presence/loitering noise as requested.

class DetectionPipeline {
  constructor() {
    this.lastAlerts = new Map(); // `${camId}_${violationType}` -> timestamp
    this.defaultCooldownMs = 15000; // 15 seconds default cooldown between alerts
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
  evaluateDetections(camera, detections, now, fw = 1280, fh = 720) {
    if (!detections || detections.length === 0) return [];

    const activeModels = camera.activeModels || [];
    if (activeModels.length === 0) return [];

    const candidates = [];
    const cooldown = (camera.cooldown_seconds ? camera.cooldown_seconds * 1000 : this.defaultCooldownMs);

    // 1. Check Face Mask Violations (NO_MASK or INCORRECT_MASK)
    if (activeModels.includes('face_mask')) {
      const maskViolations = detections.filter(d => d.model === 'face_mask' && d.isViolation);
      if (maskViolations.length > 0) {
        const topViolation = maskViolations[0];
        const alertKey = `${camera.id}_face_mask_${topViolation.status}`;
        const lastAlert = this.lastAlerts.get(alertKey) || 0;

        if (now - lastAlert >= cooldown) {
          this.lastAlerts.set(alertKey, now);

          const typeName = topViolation.status === 'NO_MASK'
            ? 'سلامة الغذاء: عدم ارتداء الكمامة في بيئة العمل'
            : 'سلامة الغذاء: ارتداء الكمامة بطريقة غير صحيحة';

          candidates.push({
            serviceSlug: 'kitchen_ppe',
            type: typeName,
            severity: topViolation.status === 'NO_MASK' ? 'high' : 'medium',
            confidence: topViolation.score,
            boundingBoxes: maskViolations.map(v =>
              this.toPercentBox(v.box, v.label, v.color, v.score, fw, fh)
            ),
            metadata: {
              model: 'face_mask',
              status: topViolation.status,
              zone: camera.zone_name || 'عام',
              count: maskViolations.length
            }
          });
        }
      }
    }

    // 2. Check Gloves & Bare Hand Violations (BARE_HAND_VIOLATION)
    if (activeModels.includes('gloves')) {
      const bareHands = detections.filter(d => d.model === 'gloves' && d.status === 'BARE_HAND_VIOLATION');
      if (bareHands.length > 0) {
        const topBareHand = bareHands[0];
        const alertKey = `${camera.id}_gloves_bare_hand`;
        const lastAlert = this.lastAlerts.get(alertKey) || 0;

        if (now - lastAlert >= cooldown) {
          this.lastAlerts.set(alertKey, now);

          candidates.push({
            serviceSlug: 'kitchen_ppe',
            type: 'سلامة الغذاء: لمس الأغذية بدون قفازات (يد مكشوفة)',
            severity: 'high',
            confidence: topBareHand.score,
            boundingBoxes: bareHands.map(h =>
              this.toPercentBox(h.box, h.label, h.color, h.score, fw, fh)
            ),
            metadata: {
              model: 'gloves',
              status: 'BARE_HAND_VIOLATION',
              zone: camera.zone_name || 'منطقة التحضير والأغذية',
              count: bareHands.length
            }
          });
        }
      }
    }

    // 3. Check Mobile Phone Usage (PHONE_DETECTED)
    if (activeModels.includes('phone')) {
      const phones = detections.filter(d => d.model === 'phone' && d.status === 'PHONE_DETECTED');
      if (phones.length > 0) {
        const topPhone = phones[0];
        const alertKey = `${camera.id}_phone_usage`;
        const lastAlert = this.lastAlerts.get(alertKey) || 0;

        if (now - lastAlert >= cooldown) {
          this.lastAlerts.set(alertKey, now);

          candidates.push({
            serviceSlug: 'phone_usage',
            type: 'انشغال العامل: استخدام الهاتف المحمول أثناء العمل',
            severity: 'medium',
            confidence: topPhone.score,
            boundingBoxes: phones.map(p =>
              this.toPercentBox(p.box, p.label, p.color, p.score, fw, fh)
            ),
            metadata: {
              model: 'phone',
              status: 'PHONE_DETECTED',
              zone: camera.zone_name || 'عام',
              count: phones.length
            }
          });
        }
      }
    }

    return candidates;
  }
}

module.exports = DetectionPipeline;
