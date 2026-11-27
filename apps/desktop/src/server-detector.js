// Saqr Server-Side AI Detection Service (Fallback Mode)
// Uses unified DetectionPipeline with ByteTrack & Priority Arbitration
// Operates as fallback when Edge Agent is not streaming to conserve VPS CPU

const AIEngine = require('./ai-engine');
const DetectionPipeline = require('./detection-pipeline');
const http = require('http');
const fs = require('fs');
const path = require('path');

const API_BASE = 'http://localhost:8080/api/v1';
const WEB_BASE = 'http://127.0.0.1:3000';
const TRAINING_LOCK_PATH = path.resolve(__dirname, '..', '..', '..', 'storage', 'training_studio', 'active.lock');

class ServerDetector {
  constructor() {
    this.ai = new AIEngine({
      confThreshold: 0.30,
      nmsThreshold: 0.45,
    });
    this.pipeline = new DetectionPipeline();
    this.token = null;
    this.running = false;
    this.isLoopRunning = false;
    this.sweepCount = 0;
    this.edgeActiveCameras = new Map(); // cameraId -> lastSeenTimestamp
  }

  async login() {
    try {
      const email = process.env.SAQR_API_EMAIL || 'fitforless@rased.com';
      const password = process.env.SAQR_API_PASSWORD || 'password123';
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
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
      const req = http.get(url, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve(null);
        }
        const contentType = res.headers['content-type'] || '';
        if (!contentType.includes('image/jpeg')) {
          res.resume();
          return resolve(null);
        }

        // Check if frame came from edge agent and update TTL
        const edgeHeader = res.headers['x-edge-streamed'];
        if (edgeHeader) {
          this.edgeActiveCameras.set(camId, Date.now());
        }

        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.setTimeout(3500, () => {
        req.destroy();
        resolve(null);
      });
      req.on('error', () => resolve(null));
    });
  }

  async uploadSnapshot(frameBuffer, cameraId) {
    try {
      const res = await fetch(`${WEB_BASE}/api/cameras/snapshot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-snapshot-id': `server_${cameraId}_${Date.now()}`
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
          ai_service_slug: serviceSlug || 'employee_monitoring',
          type,
          severity: severity || 'medium',
          confidence: parseFloat(confidence.toFixed(2)),
          bounding_boxes: JSON.stringify(boundingBoxes),
          snapshot_url: snapshotUrl || null,
          metadata: JSON.stringify({
            ...(metadata || {}),
            source: 'saqr-vps-fallback'
          })
        })
      });
      const data = await res.json();
      if (data.success) {
        if (data.deduplicated) {
          console.log(`[SERVER-AI] ⚡ Throttled duplicate: "${type}" on ${cam.name}`);
        } else {
          console.log(`[SERVER-AI] 🎯 Fallback alert logged: "${type}" [${severity}] on ${cam.name}`);
        }
      }
    } catch (e) {
      console.error('[SERVER-AI] Ingest error:', e.message);
    }
  }

  async start() {
    console.log('[SERVER-AI] Initializing Saqr Fallback Multi-Model AI Service...');
    await this.login();
    await this.ai.init();
    this.running = true;

    // Detection loop: self-scheduling after each sweep completes (1.5s rest)
    const runSweep = async () => {
      if (!this.running || this.isLoopRunning) return;
      this.isLoopRunning = true;
      try {
        await this.ai.reloadIfUpdated();
        if (!this.token) await this.login();
        let camsRes = await fetch(`${API_BASE}/cameras/`, {
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        if (camsRes.status === 401) {
          await this.login();
          camsRes = await fetch(`${API_BASE}/cameras/`, {
            headers: { 'Authorization': `Bearer ${this.token}` }
          });
        }
        const camsData = await camsRes.json();
        const cameras = camsData.data || [];
        this.sweepCount += 1;
        let liveFrames = 0;
        let skippedNoFrame = 0;
        let detectionsFound = 0;
        let eventsFound = 0;

        for (const cam of cameras) {
          try {
            // If Edge Agent is actively streaming this camera (< 60s TTL), skip server inference
            const edgeLastSeen = this.edgeActiveCameras.get(cam.id);
            if (edgeLastSeen) {
              if (Date.now() - edgeLastSeen < 60000) {
                continue;
              } else {
                this.edgeActiveCameras.delete(cam.id); // TTL expired, resume fallback automatically
              }
            }

            const frame = await this.fetchFrame(cam);
            if (!frame || frame.length < 8000) {
              skippedNoFrame += 1;
              continue;
            }
            liveFrames += 1;

            // Parse active models from camera config strictly based on user selection
            let activeModels = [];
            if (Array.isArray(cam.activeModels)) {
              activeModels = cam.activeModels;
            } else if (cam.config) {
              try {
                const cfg = typeof cam.config === 'string' ? JSON.parse(cam.config) : cam.config;
                if (Array.isArray(cfg.activeModels)) {
                  activeModels = cfg.activeModels;
                } else if (Array.isArray(cfg.enabled_services)) {
                  activeModels = [];
                  if (cfg.enabled_services.includes('kitchen_ppe') || cfg.enabled_services.includes('face_mask')) activeModels.push('face_mask');
                  if (cfg.enabled_services.includes('gloves')) activeModels.push('gloves');
                  if (cfg.enabled_services.includes('phone_usage') || cfg.enabled_services.includes('phone')) activeModels.push('phone');
                }
              } catch {}
            }

            // If no models are enabled on this camera, skip it immediately!
            if (!activeModels || activeModels.length === 0) {
              continue;
            }

            // 1. Run Multi-Model Detection
            const { detections, persons, frameWidth, frameHeight } = await this.ai.detect(frame, activeModels);
            if (!detections || detections.length === 0) continue;
            detectionsFound += detections.length;

            const fw = frameWidth || 1280;
            const fh = frameHeight || 720;
            const now = Date.now();

            // 2. Evaluate Violations
            const events = this.pipeline.evaluateDetections(
              { ...cam, activeModels },
              detections,
              now,
              fw,
              fh,
              persons
            );

            if (!events || events.length === 0) continue;
            eventsFound += events.length;

            // 3. Upload Snapshot and Post Detection
            const snapshotUrl = await this.uploadSnapshot(frame, cam.id);
            for (const ev of events) {
              await this.postDetection(cam, {
                type: ev.type,
                severity: ev.severity,
                confidence: ev.confidence,
                boundingBoxes: ev.boundingBoxes,
                snapshotUrl,
                serviceSlug: ev.serviceSlug,
                metadata: ev.metadata
              });
            }
          } catch (camErr) {
            console.warn(`[SERVER-AI] Camera error (${cam.name || cam.id}):`, camErr.message);
          }
        }

        if (this.sweepCount === 1 || this.sweepCount % 10 === 0) {
          console.log(`[SERVER-AI] 📡 Sweep #${this.sweepCount}: ${liveFrames} live cameras scanned, ${skippedNoFrame} offline/no-frame, ${detectionsFound} detections, ${eventsFound} events`);
        }
      } catch (err) {
        console.warn('[SERVER-AI] Loop error:', err.message);
      } finally {
        this.isLoopRunning = false;
        if (this.running) {
          const isTrainingActive = fs.existsSync(TRAINING_LOCK_PATH);
          setTimeout(runSweep, isTrainingActive ? 4000 : 1500);
        }
      }
    };

    runSweep();
  }
}

const detector = new ServerDetector();
detector.start();
