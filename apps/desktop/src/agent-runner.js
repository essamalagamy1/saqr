// Saqr Edge Agent — Agent Runner (Orchestrator)
const CameraWorker = require('./camera-worker');
const AIEngine = require('./ai-engine');
const ApiClient = require('./api-client');

/**
 * Tracks objects across frames to prevent alert spam.
 * Only triggers an event when a new object enters or after a re-alert cooldown.
 */
class ObjectTracker {
  constructor(options = {}) {
    this.iouThreshold = options.iouThreshold || 0.25;
    this.reAlertIntervalMs = options.reAlertIntervalMs || 180000; // 3 minutes cooldown (anti-spam)
    this.trackMaxAgeMs = options.trackMaxAgeMs || 15000; // 15s without seeing person = person left scene
    this.tracks = new Map(); // camera_id -> [ { id, label, box, firstSeen, lastSeen, lastAlerted } ]
  }

  filterNewDetections(cameraId, detections) {
    const now = Date.now();
    let cameraTracks = this.tracks.get(cameraId) || [];

    // Remove tracks that haven't been seen for trackMaxAgeMs (person walked away)
    cameraTracks = cameraTracks.filter(t => (now - t.lastSeen) < this.trackMaxAgeMs);

    const newEvents = [];

    for (const det of detections) {
      let matchedTrack = null;
      let highestIou = 0;

      for (const track of cameraTracks) {
        if (track.label === det.label) {
          const iou = this._computeIOU(track.box, det.box);
          if (iou > this.iouThreshold && iou > highestIou) {
            highestIou = iou;
            matchedTrack = track;
          }
        }
      }

      if (matchedTrack) {
        // Persistent object — update position and lastSeen
        matchedTrack.lastSeen = now;
        matchedTrack.box = det.box;

        // Re-alert only if cooldown expired
        if (now - matchedTrack.lastAlerted >= this.reAlertIntervalMs) {
          matchedTrack.lastAlerted = now;
          newEvents.push(det);
        }
      } else {
        // Genuinely new object appeared in scene!
        const newTrack = {
          id: Math.random().toString(36).slice(2, 9),
          label: det.label,
          box: det.box,
          firstSeen: now,
          lastSeen: now,
          lastAlerted: now,
        };
        cameraTracks.push(newTrack);
        newEvents.push(det);
      }
    }

    this.tracks.set(cameraId, cameraTracks);
    return newEvents;
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
}

class AgentRunner {
  constructor(store, onDetection) {
    this.store = store;
    this.onDetection = onDetection;
    this.cameraWorker = new CameraWorker();
    this.aiEngine = new AIEngine();
    this.tracker = new ObjectTracker();
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

    console.log('[AGENT] Starting Saqr Edge Agent...');

    // Initialize API client
    const serverUrl = this.store.get('serverUrl');
    const accessToken = this.store.get('accessToken');
    this.apiClient = new ApiClient(serverUrl, accessToken);

    // Initialize AI engine
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

    // Re-check API client in case serverUrl was updated
    const serverUrl = this.store.get('serverUrl');
    const accessToken = this.store.get('accessToken');
    this.apiClient = new ApiClient(serverUrl, accessToken);

    const cameras = this.store.get('cameras', []).filter(c => c.enabled !== false);
    if (cameras.length === 0) {
      console.log('[AGENT] No enabled cameras found. Waiting for cameras to be added...');
      return;
    }

    const interval = this.store.get('detectionInterval', 3);
    console.log(`[AGENT] Starting capture for ${cameras.length} camera(s) (interval=${interval}s)...`);

    let delay = 0;
    for (const camera of cameras) {
      const streamUrl = camera.subRtspUrl || camera.rtspUrl;
      if (!streamUrl) continue;
      setTimeout(() => {
        if (!this.running) return;
        console.log(`[AGENT] 🎥 Activating capture worker for: ${camera.name} (${streamUrl})`);
        this.cameraWorker.startCapture(
          camera.id,
          streamUrl,
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
      }, delay);
      delay += 300; // Stagger connection starts to avoid network / CPU spike
    }
  }

  async _processFrame(camera, frameBuffer) {
    try {
      this.stats.framesProcessed++;

      // Upload live frame to cloud platform so web dashboard live view displays real camera feed
      if (frameBuffer && frameBuffer.length > 500 && this.apiClient) {
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

      // Run AI detection
      const detections = await this.aiEngine.detect(frameBuffer, camera.id);
      this.stats.detectionsFound += detections.length;

      if (!detections || detections.length === 0) return;

      // Filter: only trigger new alerts when a new object appears or after cooldown
      const newDetections = this.tracker.filterNewDetections(camera.id, detections);
      if (newDetections.length === 0) return;

      // When multiple objects/persons are detected, group them into a rich detection
      let snapshotUrl = null;
      if (this.apiClient && frameBuffer && frameBuffer.length > 500) {
        const snapshotId = `${camera.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        snapshotUrl = await this.apiClient.uploadSnapshot(snapshotId, frameBuffer);
      }

      const colors = ['#3b82f6', '#06b6d4', '#10b981', '#a855f7', '#f59e0b', '#ec4899'];
      const richBoxes = newDetections.map((det, idx) => ({
        box: det.box,
        label: newDetections.length === 1 ? `${det.label} detected` : `${det.label} ${idx + 1} (${Math.round(det.score * 100)}%)`,
        score: det.score,
        color: colors[idx % colors.length]
      }));

      const topDet = newDetections[0];
      const isMultiple = newDetections.length > 1;
      const type = isMultiple 
        ? `رصد أشخاص متعددين (${newDetections.length} أشخاص)`
        : `${topDet.label} detected`;

      const event = {
        camera_id: camera.id,
        camera_name: camera.name,
        branch_id: camera.branchId || camera.branch_id || '',
        ai_service_slug: 'employee_monitoring',
        type,
        severity: isMultiple ? 'medium' : (topDet.label === 'person' ? 'low' : 'medium'),
        confidence: Math.max(...newDetections.map(d => d.score)),
        bounding_boxes: JSON.stringify(richBoxes),
        snapshot_url: snapshotUrl || null,
        metadata: JSON.stringify({
          class: topDet.label,
          total_objects: newDetections.length,
          boxes: richBoxes,
          source: 'saqr-edge-agent',
        }),
      };

      try {
        await this.apiClient.postDetection(event);
        this.stats.detectionsSent++;
        console.log(`[AGENT] ✅ Detection sent: ${type} from ${camera.name} (${richBoxes.length} boxes)`);
      } catch (err) {
        console.error(`[AGENT] Failed to send detection:`, err.message);
        this.stats.errors++;
      }

      // Notify renderer
      if (this.onDetection) {
        this.onDetection({
          ...event,
          timestamp: new Date().toISOString(),
          detection: topDet,
        });
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
