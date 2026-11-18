// Rased Edge Agent — Agent Runner (Orchestrator)
const CameraWorker = require('./camera-worker');
const AIEngine = require('./ai-engine');
const ApiClient = require('./api-client');

class AgentRunner {
  constructor(store, onDetection) {
    this.store = store;
    this.onDetection = onDetection;
    this.cameraWorker = new CameraWorker();
    this.aiEngine = new AIEngine();
    this.apiClient = null;
    this.running = false;
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

    console.log('[AGENT] Starting Rased Edge Agent...');

    // Initialize API client
    const serverUrl = this.store.get('serverUrl');
    const accessToken = this.store.get('accessToken');
    this.apiClient = new ApiClient(serverUrl, accessToken);

    // Initialize AI engine
    await this.aiEngine.init();

    // Get cameras
    const cameras = this.store.get('cameras', []).filter(c => c.enabled);
    if (cameras.length === 0) {
      console.log('[AGENT] No enabled cameras. Waiting...');
    }

    const interval = this.store.get('detectionInterval', 3);

    // Start capture for each camera
    for (const camera of cameras) {
      if (!camera.rtspUrl) continue;
      console.log(`[AGENT] Starting capture for: ${camera.name} (${camera.rtspUrl})`);

      this.cameraWorker.startCapture(
        camera.id,
        camera.rtspUrl,
        interval,
        async (cameraId, frame, error) => {
          if (!this.running) return;

          if (error) {
            console.error(`[AGENT] Frame capture error (${camera.name}):`, error.message);
            this.stats.errors++;
            return;
          }

          await this._processFrame(camera, frame);
        }
      );
    }

    console.log(`[AGENT] Running with ${cameras.length} camera(s), interval=${interval}s`);
  }

  async _processFrame(camera, frameBuffer) {
    try {
      this.stats.framesProcessed++;
      console.log(`[AGENT] 📸 Frame received from: ${camera.name} (${frameBuffer ? frameBuffer.length : 0} bytes)`);

      // Run AI detection
      const detections = await this.aiEngine.detect(frameBuffer);
      this.stats.detectionsFound += detections.length;

      if (!detections || detections.length === 0) return;

      // Build detection event
      for (const det of detections) {
        const event = {
          camera_id: camera.id,
          camera_name: camera.name,
          branch_id: camera.branchId || '',
          ai_service_slug: 'object_detection',
          type: `${det.label} detected`,
          severity: det.label === 'person' ? 'low' : 'medium',
          confidence: det.score,
          bounding_boxes: JSON.stringify([det.box]),
          snapshot_url: 'https://images.unsplash.com/photo-1556910103-1c02745aae4d?auto=format&fit=crop&w=600&q=80',
          metadata: JSON.stringify({
            class: det.label,
            classId: det.classId,
            source: 'rased-edge-agent',
          }),
        };

        // Send to cloud API
        try {
          await this.apiClient.postDetection(event);
          this.stats.detectionsSent++;
          console.log(`[AGENT] ✅ Detection sent: ${det.label} (${det.score}) from ${camera.name}`);
        } catch (err) {
          console.error(`[AGENT] Failed to send detection:`, err.message);
          this.stats.errors++;
        }

        // Notify renderer
        if (this.onDetection) {
          this.onDetection({
            ...event,
            timestamp: new Date().toISOString(),
            detection: det,
          });
        }
      }
    } catch (err) {
      console.error('[AGENT] Processing error:', err.message);
      this.stats.errors++;
    }
  }

  stop() {
    this.running = false;
    this.cameraWorker.stopAll();
    console.log('[AGENT] Stopped.');
  }

  getStats() {
    return { ...this.stats };
  }
}

module.exports = AgentRunner;
