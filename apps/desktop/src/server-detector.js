// Saqr Server-Side AI Detection Service (Fallback Mode)
// Uses unified DetectionPipeline with ByteTrack & Priority Arbitration
// Operates as fallback when Edge Agent is not streaming to conserve VPS CPU

const AIEngine = require('./ai-engine');
const DetectionPipeline = require('./detection-pipeline');
const http = require('http');
const path = require('path');

const API_BASE = 'http://localhost:8080/api/v1';
const WEB_BASE = 'http://127.0.0.1:3000';

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
      http.get(url, (res) => {
        if (res.statusCode !== 200) return resolve(null);
        const contentType = res.headers['content-type'] || '';
        if (!contentType.includes('image/jpeg')) return resolve(null);

        // Check if frame came from edge agent and update TTL
        const edgeHeader = res.headers['x-edge-streamed'];
        if (edgeHeader) {
          this.edgeActiveCameras.set(camId, Date.now());
        }

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

    // Detection loop: runs every 3.5s to preserve server CPU
    setInterval(async () => {
      if (!this.running || this.isLoopRunning) return;
      this.isLoopRunning = true;
      try {
        if (!this.token) await this.login();
        const camsRes = await fetch(`${API_BASE}/cameras/`, {
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        const camsData = await camsRes.json();
        const cameras = camsData.data || [];

        for (const cam of cameras) {
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
          if (!frame || frame.length < 8000) continue;

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
          const { detections, frameWidth, frameHeight } = await this.ai.detect(frame, activeModels);
          if (!detections || detections.length === 0) continue;

          const fw = frameWidth || 1280;
          const fh = frameHeight || 720;
          const now = Date.now();

          // 2. Evaluate Violations
          const events = this.pipeline.evaluateDetections(
            { ...cam, activeModels },
            detections,
            now,
            fw,
            fh
          );

          if (!events || events.length === 0) continue;

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
        }
      } catch (err) {
        console.warn('[SERVER-AI] Loop error:', err.message);
      } finally {
        this.isLoopRunning = false;
      }
    }, 3500);
  }
}

const detector = new ServerDetector();
detector.start();
