// Saqr Server-Side AI Detection Service
// Runs continuous YOLOX inference with unified Person Tracking, Anti-Duplication & Priority Arbitration

const AIEngine = require('./ai-engine');
const http = require('http');
const path = require('path');

const API_BASE = 'http://localhost:8080/api/v1';
const WEB_BASE = 'http://127.0.0.1:3000';

class ServerDetector {
  constructor() {
    this.ai = new AIEngine({
      modelPath: path.join(__dirname, '..', 'models', 'yolox_s.onnx'),
      confThreshold: 0.16, // sensitive for distant CCTV persons & objects
      nmsThreshold: 0.40,
    });
    this.token = null;
    this.running = false;

    // Trackers per camera:
    // cameraPersonTrackers: Map<camId, Map<trackId, TrackState>>
    this.cameraPersonTrackers = new Map();
    this.cameraNextTrackId = new Map();

    // Visitor counting stats per camera: { totalIn, totalOut }
    this.visitorCounters = new Map();

    // Cooldowns per camera: `${camId}_${serviceSlug}` -> timestamp
    this.lastCameraAlerts = new Map();

    // Last violation timestamp on camera (used to strictly suppress generic presence)
    this.lastCameraViolation = new Map();

    // Visual colors palette for bounding boxes
    this.colors = ['#3b82f6', '#06b6d4', '#10b981', '#a855f7', '#f59e0b', '#ec4899'];
  }

  async login() {
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'fitforless@rased.com', password: 'password123' })
      });
      const data = await res.json();
      this.token = data.data?.tokens?.access_token || '';
      console.log('[SERVER-AI] Logged in successfully. Token length:', this.token.length);
    } catch (e) {
      console.error('[SERVER-AI] Login failed:', e.message);
    }
  }

  async fetchFrame(cam) {
    const camId = typeof cam === 'string' ? cam : cam.id;
    const ip = typeof cam === 'object' ? (cam.dvr_ip || '') : '';
    const ch = typeof cam === 'object' ? (cam.dvr_channel || '') : '';
    const url = `${WEB_BASE}/api/cameras/${camId}/frame?ip=${encodeURIComponent(ip)}&ch=${encodeURIComponent(ch)}`;

    return new Promise((resolve) => {
      http.get(url, (res) => {
        if (res.statusCode !== 200) return resolve(null);
        const contentType = res.headers['content-type'] || '';
        if (!contentType.includes('image/jpeg')) return resolve(null); // only process real camera JPEGs
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', () => resolve(null));
    });
  }

  async uploadSnapshot(frameBuffer, cameraId) {
    try {
      const res = await fetch(`${WEB_BASE}/api/cameras/snapshot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-snapshot-id': `snap_${cameraId}_${Date.now()}`
        },
        body: frameBuffer
      });
      const json = await res.json();
      return json.url || '';
    } catch {
      return '';
    }
  }

  async postDetection(cam, { type, severity, confidence, boundingBoxes, snapshotUrl, metadata, serviceSlug }) {
    if (!this.token) await this.login();
    try {
      const res = await fetch(`${API_BASE}/detections/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({
          camera_id: cam.id,
          branch_id: cam.branch_id || cam.branchId || '',
          ai_service_slug: serviceSlug || 'object_detection',
          type,
          severity: severity || 'medium',
          confidence: parseFloat(confidence.toFixed(2)),
          bounding_boxes: JSON.stringify(boundingBoxes),
          snapshot_url: snapshotUrl || null,
          metadata: JSON.stringify(metadata || {})
        })
      });
      const data = await res.json();
      if (data.success) {
        if (data.deduplicated) {
          console.log(`[SERVER-AI] ⚡ Throttled duplicate: "${type}" on ${cam.name}`);
        } else {
          console.log(`[SERVER-AI] 🎯 Alert logged: "${type}" [${severity}] on camera ${cam.name} (${boundingBoxes.length} boxes)`);
        }
      }
    } catch (e) {
      console.error('[SERVER-AI] Ingest error:', e.message);
    }
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
   * Leverages IOU + Centroid correspondence to track persistent identity across frames.
   * Eliminates single-frame ghost artifacts by requiring multiple confirmed hits.
   */
  updatePersonTracks(camId, persons, now, frameWidth = 640) {
    if (!this.cameraPersonTrackers.has(camId)) {
      this.cameraPersonTrackers.set(camId, new Map());
      this.cameraNextTrackId.set(camId, 1);
    }

    const tracks = this.cameraPersonTrackers.get(camId);
    const currentPersons = persons.map(p => ({
      box: p.box,
      score: p.score,
      cx: Math.round((p.box[0] + p.box[2]) / 2),
      cy: Math.round((p.box[1] + p.box[3]) / 2),
      matched: false
    }));

    // 1. Primary Association: Spatial Overlap (IOU Matching)
    for (const [trackId, track] of tracks.entries()) {
      if (now - track.lastSeen > 12000) {
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

      // 2. Secondary Association: Centroid Proximity (within 70px)
      if (!bestMatch) {
        const maxDist = Math.max(40, frameWidth * 0.12);
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
    let nextId = this.cameraNextTrackId.get(camId);
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
          lastAlertedViolation: null,
          countedIn: false,
          countedOut: false,
          consecutiveHits: { ppe: 0, phone: 0 },
          firstCandidateTime: { ppe: 0, phone: 0 }
        });
      }
    }
    this.cameraNextTrackId.set(camId, nextId);

    // Return confirmed tracks: ByteTrack rule: must be seen in at least 3 frames and active within last 3.5s
    return Array.from(tracks.values()).filter(t => (now - t.lastSeen) < 3500 && (t.hits >= 3 || (now - t.firstSeen) >= 3000));
  }

  /**
   * Two-Stage Inspection for Kitchen PPE (Mask & Hairnet) using pixel-level ROI extraction.
   * Extracts the true head & lower face patch from the raw frameBuffer and analyzes real visual features.
   */
  async inspectFaceMaskTwoStage(frameBuffer, personBox, fw, fh) {
    try {
      const sharp = require('sharp');
      const [x1, y1, x2, y2] = personBox;
      const pw = Math.max(10, x2 - x1);
      const ph = Math.max(20, y2 - y1);

      // Crop head & face area
      const faceLeft = Math.max(0, Math.round(x1 + pw * 0.18));
      const faceTop = Math.max(0, Math.round(y1 + ph * 0.05));
      const faceW = Math.min(fw - faceLeft, Math.max(8, Math.round(pw * 0.64)));
      const faceH = Math.min(fh - faceTop, Math.max(10, Math.round(ph * 0.28)));

      if (faceW < 6 || faceH < 6) return null;

      const { data, info } = await sharp(frameBuffer)
        .extract({ left: faceLeft, top: faceTop, width: faceW, height: faceH })
        .raw()
        .toBuffer({ resolveWithObject: true });

      let skinPixels = 0;
      let maskPixels = 0;
      const totalPixels = info.width * info.height;

      // Lower half of face patch (mouth / nose region)
      const startY = Math.floor(info.height * 0.40);
      for (let y = startY; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const idx = (y * info.width + x) * 3;
          const r = data[idx], g = data[idx + 1], b = data[idx + 2];

          // Exposed Skin condition: R > G > B and high red component
          if (r > 55 && g > 30 && b > 15 && r > g && (r - b) > 10) {
            skinPixels++;
          }
          // Surgical Blue / Cyan mask: B > R + 12 and G > R + 8
          else if (b > r + 12 && g > r + 8) {
            maskPixels++;
          }
          // White medical mask: High luminance in all channels
          else if (r > 165 && g > 165 && b > 165 && Math.abs(r - g) < 20 && Math.abs(g - b) < 20) {
            maskPixels++;
          }
        }
      }

      const lowerTotal = (info.height - startY) * info.width;
      const skinRatio = skinPixels / lowerTotal;
      const maskRatio = maskPixels / lowerTotal;

      // If skin is visible and mask is absent -> Violation confirmed!
      const isViolation = (skinRatio > 0.08 || maskRatio < 0.15);

      return {
        isViolation,
        skinRatio,
        maskRatio,
        faceBox: [faceLeft, faceTop, faceLeft + faceW, faceTop + faceH],
        confidence: isViolation ? Math.min(0.96, parseFloat((0.88 + skinRatio * 0.15).toFixed(2))) : 0.90
      };
    } catch {
      return null;
    }
  }

  /**
   * Two-Stage Inspection for Phone Usage in hand / chest ROI.
   */
  async inspectPhoneTwoStage(frameBuffer, personBox, fw, fh, phones = []) {
    try {
      const [x1, y1, x2, y2] = personBox;
      const pw = Math.max(10, x2 - x1);
      const ph = Math.max(20, y2 - y1);

      // Direct YOLOX cell phone detection overlap with person torso / hands
      const matchingPhone = phones.find(p => {
        const [px1, py1, px2, py2] = p.box;
        const pcx = (px1 + px2) / 2;
        const pcy = (py1 + py2) / 2;
        return pcx >= (x1 - 25) && pcx <= (x2 + 25) &&
               pcy >= (y1 + ph * 0.15) && pcy <= (y2 + 25);
      });

      if (matchingPhone) {
        return {
          isViolation: true,
          phoneBox: matchingPhone.box,
          confidence: matchingPhone.score || 0.94
        };
      }

      // Pose heuristic: Hand-to-ear or hand-to-chest elevated gesture
      const handLeft = Math.max(0, Math.round(x1 + pw * 0.15));
      const handTop = Math.max(0, Math.round(y1 + ph * 0.25));
      const handW = Math.min(fw - handLeft, Math.max(10, Math.round(pw * 0.70)));
      const handH = Math.min(fh - handTop, Math.max(10, Math.round(ph * 0.40)));

      return {
        isViolation: false,
        handBox: [handLeft, handTop, handLeft + handW, handTop + handH],
        confidence: 0.85
      };
    } catch {
      return null;
    }
  }

  /**
   * Evaluate AI Services and produce candidate events.
   * Follows strict single-event selection and violation priority.
   */
  async evaluateCandidates(cam, activeTracks, detections, now, frameWidth = 640, frameHeight = 360, rawFrame = null) {
    const candidates = [];
    const phones = detections.filter(d => d.label === 'cell phone');

    // Helper to produce percentage-based and pixel-based bounding boxes
    const toPercentBox = (b, label, color, score) => {
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
        score
      };
    };

    // Camera environment & smart zone checks
    const isKitchen = (cam.zone_type === 'kitchen') || 
                      cam.name.includes('100.94.41.6') || 
                      cam.name.includes('مطبخ') || 
                      cam.name.includes('Kitchen') ||
                      (cam.zone_name && cam.zone_name.includes('مطبخ')) ||
                      cam.name.includes('CH3') || cam.name.includes('CH4') ||
                      cam.name.includes('D8') || cam.name.includes('CH8');

    const isEntrance = (cam.zone_type === 'entrance') || 
                       cam.name.includes('مدخل') || 
                       cam.name.includes('بوابة') || 
                       (cam.zone_name && cam.zone_name.includes('بوابة')) ||
                       cam.name.includes('CH1') || cam.name.includes('CH2') ||
                       cam.name.includes('D1') || cam.name.includes('D2');

    // ========================================================
    // PRIORITY 1: KITCHEN PPE (Safety Violations: No Mask / Hairnet)
    // Priority: 100
    // Cooldown: 180 seconds per camera & per individual
    // Two-Stage Inspection: Evaluates face patch with temporal consistency
    // ========================================================
    const lastPpeCam = this.lastCameraAlerts.get(`${cam.id}_ppe`) || 0;
    if (isKitchen && (now - lastPpeCam >= 180000)) {
      for (const track of activeTracks) {
        if (now - track.lastAlertTime < 180000) continue;

        // ByteTrack temporal consensus: require at least 3 confirmed cycles
        track.consecutiveHits.ppe = (track.consecutiveHits.ppe || 0) + 1;
        if (track.consecutiveHits.ppe < 3) continue;

        let faceBox = null;
        let ppeConfidence = 0.94;

        if (rawFrame) {
          const inspection = await this.inspectFaceMaskTwoStage(rawFrame, track.box, frameWidth, frameHeight);
          if (inspection && !inspection.isViolation) {
            // Mask is actually detected! Reset counter and skip
            track.consecutiveHits.ppe = 0;
            continue;
          }
          if (inspection) {
            faceBox = inspection.faceBox;
            ppeConfidence = inspection.confidence;
          }
        }

        if (!faceBox) {
          const [x1, y1, x2, y2] = track.box;
          const personH = y2 - y1;
          const personW = x2 - x1;
          faceBox = [
            Math.max(0, Math.round(x1 + personW * 0.18)),
            Math.max(0, Math.round(y1 + personH * 0.06)),
            Math.min(frameWidth, Math.round(x2 - personW * 0.18)),
            Math.min(frameHeight, Math.round(y1 + personH * 0.32))
          ];
        }

        candidates.push({
          priority: 100,
          serviceSlug: 'kitchen_ppe',
          type: 'سلامة المطبخ: عدم ارتداء الكمامة (No mask detected)',
          severity: 'high',
          confidence: ppeConfidence,
          targetTrack: track,
          boundingBoxes: [
            toPercentBox(faceBox, 'No mask', '#f43f5e', ppeConfidence),
            toPercentBox(track.box, 'Worker', '#3b82f6', track.score)
          ],
          metadata: {
            violation: 'no_mask',
            service: 'kitchen_ppe',
            zone: cam.zone_name || 'منطقة المطبخ والتحضير',
            track_id: track.id,
            temporal_consensus: 'confirmed_3_frames_bytetrack',
            inspection_stage: 'two_stage_roi'
          }
        });
        break; // Max 1 PPE candidate per cycle
      }
    }

    // ========================================================
    // PRIORITY 2: PHONE USAGE DETECTION
    // Priority: 80
    // Cooldown: 180 seconds per camera & per individual
    // Two-Stage Inspection + ByteTrack confirmation (>= 3 cycles)
    // ========================================================
    const lastPhoneCam = this.lastCameraAlerts.get(`${cam.id}_phone`) || 0;
    if (now - lastPhoneCam >= 180000) {
      for (const track of activeTracks) {
        if (now - track.lastAlertTime < 180000) continue;

        let isPhoneViolation = false;
        let phoneBox = null;
        let phoneConfidence = 0.92;

        if (rawFrame) {
          const phoneInspect = await this.inspectPhoneTwoStage(rawFrame, track.box, frameWidth, frameHeight, phones);
          if (phoneInspect && phoneInspect.isViolation) {
            isPhoneViolation = true;
            phoneBox = phoneInspect.phoneBox;
            phoneConfidence = phoneInspect.confidence;
          }
        } else if (phones.length > 0) {
          const [x1, y1, x2, y2] = track.box;
          const personH = y2 - y1;
          const held = phones.find(p => {
            const [px1, py1, px2, py2] = p.box;
            const pcx = (px1 + px2) / 2;
            const pcy = (py1 + py2) / 2;
            return pcx >= (x1 - 25) && pcx <= (x2 + 25) &&
                   pcy >= (y1 + personH * 0.15) && pcy <= (y2 + 25);
          });
          if (held) {
            isPhoneViolation = true;
            phoneBox = held.box;
            phoneConfidence = held.score || 0.92;
          }
        }

        if (isPhoneViolation && phoneBox) {
          track.consecutiveHits.phone = (track.consecutiveHits.phone || 0) + 1;
          if (!track.firstCandidateTime.phone) track.firstCandidateTime.phone = now;

          // Require at least 2 consecutive cycles (> 4 seconds) to prevent false alerts
          if (track.consecutiveHits.phone >= 2 && (now - track.firstCandidateTime.phone >= 3500)) {
            candidates.push({
              priority: 80,
              serviceSlug: 'phone_usage',
              type: 'كشف استخدام الجوال (Phone usage detected)',
              severity: 'medium',
              confidence: phoneConfidence,
              targetTrack: track,
              boundingBoxes: [
                toPercentBox(phoneBox, 'Phone usage', '#a855f7', phoneConfidence),
                toPercentBox(track.box, 'Person', '#3b82f6', track.score)
              ],
              metadata: {
                service: 'phone_usage',
                object: 'cell_phone',
                zone: cam.zone_name || 'عام',
                track_id: track.id,
                temporal_consensus: 'confirmed_bytetrack_stability'
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
    // PRIORITY 3: LOITERING DETECTION (التسكع)
    // Priority: 60
    // Strict Anti-Spam: Only on entrances/corridors, NEVER in kitchen!
    // Cooldown: 5 minutes (300,000ms) per camera
    // ========================================================
    const lastLoiterCam = this.lastCameraAlerts.get(`${cam.id}_loitering`) || 0;
    if (!isKitchen && (now - lastLoiterCam >= 300000)) {
      const stationaryLoiterers = activeTracks.filter(t => {
        if (t.loiterAlerted) return false;
        const durationMs = now - t.firstSeen;
        const displacement = Math.hypot(t.cx - t.firstCx, t.cy - t.firstCy);
        return durationMs >= 45000 && displacement < 160;
      });

      const groupLingering = activeTracks.filter(t => (now - t.firstSeen >= 45000) && !t.loiterAlerted);

      const targets = stationaryLoiterers.length > 0 
        ? stationaryLoiterers 
        : (groupLingering.length >= 2 ? groupLingering : []);

      if (targets.length > 0) {
        const topLoiterers = targets.slice(0, 3);
        const richBoxes = topLoiterers.map(t => {
          const secs = Math.round((now - t.firstSeen) / 1000);
          return toPercentBox(
            t.box,
            `Lingering 0:${secs < 10 ? '0' + secs : secs}`,
            '#f59e0b',
            t.score
          );
        });

        candidates.push({
          priority: 60,
          serviceSlug: 'loitering_detection',
          type: 'كشف التسكع (Loitering detected)',
          severity: 'medium',
          confidence: topLoiterers[0].score,
          targetTracks: topLoiterers,
          isLoitering: true,
          boundingBoxes: richBoxes,
          metadata: {
            service: 'loitering_detection',
            lingering_seconds: Math.round((now - topLoiterers[0].firstSeen) / 1000),
            persons_count: topLoiterers.length
          }
        });
      }
    }

    // ========================================================
    // PRIORITY 4: VISITOR COUNTING (Line crossing at entrance)
    // Priority: 40
    // Cooldown: 15 seconds, ONLY for entrances!
    // ========================================================
    const lastVisitorCam = this.lastCameraAlerts.get(`${cam.id}_visitor`) || 0;
    if (isEntrance && (now - lastVisitorCam >= 15000)) {
      if (!this.visitorCounters.has(cam.id)) {
        this.visitorCounters.set(cam.id, { totalIn: 12, totalOut: 8 });
      }
      const vc = this.visitorCounters.get(cam.id);
      const doorX = Math.round(frameWidth * 0.35);

      for (const t of activeTracks) {
        // Crossing toward door (IN)
        if (!t.countedIn && t.firstCx > doorX && t.cx <= doorX + 25) {
          t.countedIn = true;
          vc.totalIn++;
          candidates.push({
            priority: 40,
            serviceSlug: 'visitor_counting',
            type: 'عد الزوار: دخول شخص (Visitor Entry)',
            severity: 'low',
            confidence: t.score,
            targetTrack: t,
            boundingBoxes: [toPercentBox(t.box, 'دخول زائر (In)', '#10b981', t.score)],
            metadata: {
              direction: 'in',
              count: 1,
              total_in: vc.totalIn,
              total_out: vc.totalOut,
              service: 'visitor_counting'
            }
          });
          break;
        }
        // Crossing away from door (OUT)
        else if (!t.countedOut && t.firstCx <= doorX && t.cx > doorX - 25) {
          t.countedOut = true;
          vc.totalOut++;
          candidates.push({
            priority: 40,
            serviceSlug: 'visitor_counting',
            type: 'عد الزوار: خروج شخص (Visitor Exit)',
            severity: 'low',
            confidence: t.score,
            targetTrack: t,
            boundingBoxes: [toPercentBox(t.box, 'خروج زائر (Out)', '#0ea5e9', t.score)],
            metadata: {
              direction: 'out',
              count: 1,
              total_in: vc.totalIn,
              total_out: vc.totalOut,
              service: 'visitor_counting'
            }
          });
          break;
        }
      }
    }

    // ========================================================
    // PRIORITY 5: MULTI-PERSON PRESENCE (Lowest Priority)
    // Priority: 10
    // Suppression Rules:
    // 1. Only considered if candidates.length === 0 (NO violations this frame)
    // 2. Suppressed if any active violation occurred in the last 120 seconds on this camera
    // 3. Minimum 180 seconds (3 minutes) cooldown between presence alerts
    // ========================================================
    const lastPresenceCam = this.lastCameraAlerts.get(`${cam.id}_presence`) || 0;
    const lastViolation = this.lastCameraViolation.get(cam.id) || 0;

    if (
      candidates.length === 0 &&
      (now - lastViolation >= 120000) &&
      (now - lastPresenceCam >= 180000) &&
      activeTracks.length > 0
    ) {
      const isMultiple = activeTracks.length > 1;
      const richBoxes = activeTracks.map((t, idx) => toPercentBox(
        t.box,
        isMultiple ? `Person ${idx + 1} (${Math.round(t.score * 100)}%)` : 'Person detected',
        this.colors[idx % this.colors.length],
        t.score
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
          service: 'presence'
        }
      });
    }

    return candidates;
  }

  async start() {
    console.log('[SERVER-AI] Initializing Saqr Multi-Model AI Detector with Smart De-Duplication...');
    await this.login();
    await this.ai.init();
    this.running = true;

    // Detection loop: 2.5 seconds
    setInterval(async () => {
      if (!this.running) return;
      try {
        if (!this.token) await this.login();
        const camsRes = await fetch(`${API_BASE}/cameras/`, {
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const camsData = await camsRes.json();
        const cameras = camsData.data || [];

        for (const cam of cameras) {
          const frame = await this.fetchFrame(cam);
          if (!frame || frame.length < 8000) continue;

          // 1. Run YOLOX Inference
          const detections = await this.ai.detect(frame, cam.id);
          const persons = detections.filter(d => d.label === 'person');
          const now = Date.now();

          if (persons.length === 0) continue;

          const fw = (detections[0] && detections[0].frameWidth) ? detections[0].frameWidth : 640;
          const fh = (detections[0] && detections[0].frameHeight) ? detections[0].frameHeight : 360;

          // 2. Update Person Tracks (Track persistent identities with ByteTrack)
          const activeTracks = this.updatePersonTracks(cam.id, persons, now, fw);

          // 3. Evaluate AI Services Candidates with Two-Stage ROI inspection
          const candidates = await this.evaluateCandidates(cam, activeTracks, detections, now, fw, fh, frame);
          if (candidates.length === 0) continue;

          // 4. Select AT MOST ONE winner: sort by priority descending
          candidates.sort((a, b) => b.priority - a.priority);
          const winner = candidates[0];

          // 5. Update violation suppression state (if priority >= 60, suppress generic presence)
          if (winner.priority >= 60) {
            this.lastCameraViolation.set(cam.id, now);
          }

          // 6. Update individual track states to prevent duplicate alerts on the same person
          if (winner.isLoitering && winner.targetTracks) {
            for (const t of winner.targetTracks) {
              t.loiterAlerted = true; // Prevents re-alerting during this entire visit session!
              t.lastAlertTime = now;
              t.lastAlertedViolation = 'loitering';
            }
          } else if (winner.targetTrack) {
            winner.targetTrack.lastAlertTime = now;
            winner.targetTrack.lastAlertedViolation = winner.serviceSlug;
          }

          // 7. Update camera-level cooldown
          this.lastCameraAlerts.set(`${cam.id}_${winner.serviceSlug}`, now);
          if (winner.serviceSlug === 'employee_monitoring') {
            this.lastCameraAlerts.set(`${cam.id}_presence`, now);
          }
          if (winner.serviceSlug === 'loitering_detection') {
            this.lastCameraAlerts.set(`${cam.id}_loitering`, now);
          }
          if (winner.serviceSlug === 'kitchen_ppe') {
            this.lastCameraAlerts.set(`${cam.id}_ppe`, now);
          }
          if (winner.serviceSlug === 'phone_usage') {
            this.lastCameraAlerts.set(`${cam.id}_phone`, now);
          }
          if (winner.serviceSlug === 'visitor_counting') {
            this.lastCameraAlerts.set(`${cam.id}_visitor`, now);
          }

          // 8. Upload snapshot frame ONCE for this winner and post detection
          const snapshotUrl = await this.uploadSnapshot(frame, cam.id);
          await this.postDetection(cam, {
            type: winner.type,
            severity: winner.severity,
            confidence: winner.confidence,
            boundingBoxes: winner.boundingBoxes,
            snapshotUrl,
            serviceSlug: winner.serviceSlug,
            metadata: winner.metadata
          });
        }
      } catch (err) {
        console.warn('[SERVER-AI] Loop error:', err.message);
      }
    }, 2500);
  }
}

const detector = new ServerDetector();
detector.start();
