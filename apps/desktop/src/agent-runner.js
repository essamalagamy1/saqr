// Saqr Edge Agent — Agent Runner (Orchestrator)
// Runs on client edge with hardware acceleration (DirectML GPU / CPU)
// Persistent FFmpeg video pipeline + ByteTrack + Multi-Service AI Detection

const CameraWorker = require('./camera-worker');
const AIEngine = require('./ai-engine');
const ApiClient = require('./api-client');
const DetectionPipeline = require('./detection-pipeline');

class AgentRunner {
  constructor(store, onDetection) {
    this.store = store;
    this.onDetection = onDetection;
    this.cameraWorker = new CameraWorker();
    this.aiEngine = new AIEngine({ confThreshold: 0.30 });
    this.pipeline = new DetectionPipeline();
    this.apiClient = null;
    this.running = false;
    this.cameraBusy = new Map(); // cameraId -> boolean
    this.lastFrameUpload = new Map(); // cameraId -> timestamp
    this.stats = {
      framesProcessed: 0,
      detectionsFound: 0,
      detectionsSent: 0,
      errors: 0,
      startedAt: null,
    };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.stats.startedAt = new Date();

    console.log('[AGENT] 🚀 Starting Saqr Edge Agent Engine...');

    // Initialize API client
    const serverUrl = this.store.get('serverUrl');
    const accessToken = this.store.get('accessToken');
    this.apiClient = new ApiClient(serverUrl, accessToken);

    // Initialize AI engine (DirectML / CPU)
    try {
      await this.aiEngine.init();
    } catch (err) {
      console.warn('[AGENT] AI engine init warning:', err.message);
    }

    this.reloadCameras();
  }

  reloadCameras() {
    if (!this.running) return;
    console.log('[AGENT] Refreshing active camera workers...');
    this.cameraWorker.stopAll();
    this.cameraBusy.clear();

    // Re-check API client in case serverUrl was updated
    const serverUrl = this.store.get('serverUrl');
    const accessToken = this.store.get('accessToken');
    this.apiClient = new ApiClient(serverUrl, accessToken);

    const cameras = this.store.get('cameras', []).filter(c => c.enabled !== false);
    if (cameras.length === 0) {
      console.log('[AGENT] No enabled cameras found. Waiting for cameras to be added...');
      return;
    }

    console.log(`[AGENT] Starting persistent MJPEG pipeline for ${cameras.length} camera(s) at 2 FPS...`);

    let delay = 0;
    for (const camera of cameras) {
      let streamUrl = camera.subRtspUrl || camera.rtspUrl;
      if (!streamUrl) continue;

      // Preserve credentials from rtspUrl if subRtspUrl lacks them
      if (camera.rtspUrl && camera.rtspUrl.includes('@') && !streamUrl.includes('@')) {
        const authMatch = camera.rtspUrl.match(/^rtsp[s]?:\/\/([^@]+)@/i);
        if (authMatch) {
          streamUrl = streamUrl.replace(/^rtsp[s]?:\/\//i, `rtsp://${authMatch[1]}@`);
        }
      }

      setTimeout(() => {
        if (!this.running) return;
        const sanitizedUrl = streamUrl.replace(/\/\/[^@]+@/, '//***:***@');
        console.log(`[AGENT] 🎥 Activating persistent stream: ${camera.name} (${sanitizedUrl})`);

        this.cameraWorker.startCapture(
          camera.id,
          streamUrl,
          2, // 2 FPS continuous MJPEG stream
          async (cameraId, frameBuffer) => {
            if (!this.running) return;
            await this._processFrame(camera, frameBuffer);
          }
        );
      }, delay);
      delay += 400; // Stagger stream start to avoid network contention
    }
  }

  async _processFrame(camera, frameBuffer) {
    if (!frameBuffer || frameBuffer.length < 5000) return;

    // Drop-on-busy pattern: drop incoming frame if previous inference is still executing
    if (this.cameraBusy.get(camera.id)) {
      return;
    }
    this.cameraBusy.set(camera.id, true);

    try {
      this.stats.framesProcessed++;
      const now = Date.now();

      // 1. Non-blocking live frame upload for dashboard preview (throttled to 1 frame / 2 seconds)
      const lastUpload = this.lastFrameUpload.get(camera.id) || 0;
      if (now - lastUpload >= 2000 && this.apiClient) {
        this.lastFrameUpload.set(camera.id, now);

        let ip = camera.dvrIp;
        if (!ip && camera.rtspUrl) {
          const m = camera.rtspUrl.match(/@?([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})/);
          if (m) ip = m[1];
        }
        let ch = camera.dvrChannel ? camera.dvrChannel.toUpperCase().trim() : (camera.channel ? `CH${camera.channel}` : '');
        if (!ch && camera.rtspUrl) {
          const chMatch = camera.rtspUrl.match(/\/Streaming\/Channels\/(\d{1,2})(?:01|02|03)/i) ||
                          camera.rtspUrl.match(/\/cam\/realmonitor\?channel=(\d+)/i) ||
                          camera.rtspUrl.match(/\/ch(\d+)\//i) ||
                          camera.rtspUrl.match(/\/(\d{1,2})01\b/i);
          if (chMatch) ch = `CH${parseInt(chMatch[1], 10)}`;
        }
        if (!ch) ch = 'CH1';

        this.apiClient.uploadCameraFrame(camera.id, ip, ch, frameBuffer).catch(() => {});
      }

      // 2. Run YOLOX Primary Object Detection
      const detections = await this.aiEngine.detect(frameBuffer, camera.id);
      this.stats.detectionsFound += detections.length;

      const persons = detections.filter(d => d.label === 'person');
      if (persons.length === 0) {
        return;
      }

      const fw = detections[0]?.frameWidth || 1280;
      const fh = detections[0]?.frameHeight || 720;

      // 3. Update ByteTrack Person Tracks across frames
      const activeTracks = this.pipeline.updatePersonTracks(camera.id, persons, now, fw);
      if (activeTracks.length === 0) {
        return;
      }

      // 4. Multi-Service Two-Stage Evaluation with Priority Arbitration
      const winner = await this.pipeline.evaluateCandidates(
        camera,
        activeTracks,
        detections,
        now,
        fw,
        fh,
        frameBuffer,
        this.aiEngine
      );

      if (!winner) {
        return;
      }

      // 5. Upload Detection Snapshot if client available
      let snapshotUrl = null;
      if (this.apiClient) {
        const snapshotId = `edge_${camera.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        snapshotUrl = await this.apiClient.uploadSnapshot(snapshotId, frameBuffer);
      }

      const eventPayload = {
        camera_id: camera.id,
        camera_name: camera.name,
        branch_id: camera.branchId || camera.branch_id || '',
        ai_service_slug: winner.serviceSlug,
        type: winner.type,
        severity: winner.severity || 'medium',
        confidence: parseFloat(winner.confidence.toFixed(2)),
        bounding_boxes: JSON.stringify(winner.boundingBoxes),
        snapshot_url: snapshotUrl || null,
        metadata: JSON.stringify({
          ...winner.metadata,
          source: 'saqr-edge-directml',
        }),
      };

      // 6. Ingest Detection to API Server
      if (this.apiClient) {
        try {
          const res = await this.apiClient.postDetection(eventPayload);
          this.stats.detectionsSent++;
          if (res.deduplicated) {
            console.log(`[AGENT] ⚡ Deduplicated alert: "${winner.type}" on ${camera.name}`);
          } else {
            console.log(`[AGENT] 🎯 Event logged: "${winner.type}" [${winner.severity}] on ${camera.name}`);
          }
        } catch (err) {
          console.error(`[AGENT] Failed to ingest detection:`, err.message);
          this.stats.errors++;
        }
      }

      // 7. Notify Local Electron Renderer Window
      if (this.onDetection) {
        this.onDetection({
          ...eventPayload,
          timestamp: new Date().toISOString(),
          winner,
        });
      }
    } catch (err) {
      console.error('[AGENT] Processing error:', err.message);
      this.stats.errors++;
    } finally {
      this.cameraBusy.set(camera.id, false);
    }
  }

  stop() {
    this.running = false;
    this.cameraWorker.stopAll();
    this.cameraBusy.clear();
    console.log('[AGENT] Stopped.');
  }

  getStats() {
    return { ...this.stats };
  }
}

module.exports = AgentRunner;
