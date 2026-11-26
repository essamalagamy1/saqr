// Saqr Lightweight Two-Stage ByteTrack-Style Multi-Object Tracker
// Associates person detections across CCTV frames using high-confidence first,
// then low-confidence recovery for brief occlusions.

class CameraPersonTracker {
  constructor(options = {}) {
    this.highThresh = options.highThresh ?? 0.42;
    this.lowThresh = options.lowThresh ?? 0.20;
    this.iouThresh = options.iouThresh ?? 0.25;
    this.maxAgeMs = options.maxAgeMs ?? 8000;
    this.nextId = 1;
    this.tracks = new Map(); // trackId -> { trackId, box, score, lastSeen, hits }
  }

  static iou(a, b) {
    const interX1 = Math.max(a[0], b[0]);
    const interY1 = Math.max(a[1], b[1]);
    const interX2 = Math.min(a[2], b[2]);
    const interY2 = Math.min(a[3], b[3]);
    const iw = Math.max(0, interX2 - interX1);
    const ih = Math.max(0, interY2 - interY1);
    const inter = iw * ih;
    if (inter <= 0) return 0;
    const areaA = Math.max(1, (a[2] - a[0]) * (a[3] - a[1]));
    const areaB = Math.max(1, (b[2] - b[0]) * (b[3] - b[1]));
    return inter / (areaA + areaB - inter);
  }

  _matchGreedy(trackList, detList) {
    const pairs = [];
    for (let ti = 0; ti < trackList.length; ti++) {
      for (let di = 0; di < detList.length; di++) {
        const score = CameraPersonTracker.iou(trackList[ti].box, detList[di].box);
        if (score >= this.iouThresh) {
          pairs.push({ ti, di, score });
        }
      }
    }
    pairs.sort((a, b) => b.score - a.score);

    const matchedTracks = new Set();
    const matchedDets = new Set();
    const matches = [];
    for (const p of pairs) {
      if (matchedTracks.has(p.ti) || matchedDets.has(p.di)) continue;
      matchedTracks.add(p.ti);
      matchedDets.add(p.di);
      matches.push({ track: trackList[p.ti], det: detList[p.di] });
    }
    return {
      matches,
      unmatchedTracks: trackList.filter((_, i) => !matchedTracks.has(i)),
      unmatchedDets: detList.filter((_, i) => !matchedDets.has(i)),
    };
  }

  /**
   * Update tracker with current frame person detections: [{ box: [x1,y1,x2,y2], score }]
   * Returns persons annotated with persistent `trackId`.
   */
  update(personDetections, now = Date.now()) {
    // Prune expired tracks
    for (const [id, tr] of this.tracks.entries()) {
      if (now - tr.lastSeen > this.maxAgeMs) {
        this.tracks.delete(id);
      }
    }

    const highDets = [];
    const lowDets = [];
    for (const d of personDetections || []) {
      if ((d.score ?? 0) >= this.highThresh) highDets.push(d);
      else if ((d.score ?? 0) >= this.lowThresh) lowDets.push(d);
    }

    const activeTracks = Array.from(this.tracks.values());
    const stage1 = this._matchGreedy(activeTracks, highDets);

    const output = [];
    for (const { track, det } of stage1.matches) {
      track.box = det.box;
      track.score = det.score;
      track.lastSeen = now;
      track.hits += 1;
      output.push({ ...det, trackId: track.trackId });
    }

    // Stage 2 (ByteTrack): match remaining tracks against low-confidence detections
    const stage2 = this._matchGreedy(stage1.unmatchedTracks, lowDets);
    for (const { track, det } of stage2.matches) {
      track.box = det.box;
      track.score = det.score;
      track.lastSeen = now;
      track.hits += 1;
      output.push({ ...det, trackId: track.trackId });
    }

    // Spawn new tracks for unmatched high-confidence detections
    for (const det of stage1.unmatchedDets) {
      const trackId = this.nextId++;
      const tr = { trackId, box: det.box, score: det.score, lastSeen: now, hits: 1 };
      this.tracks.set(trackId, tr);
      output.push({ ...det, trackId });
    }

    return output;
  }
}

class MultiCameraTracker {
  constructor(options = {}) {
    this.options = options;
    this.cameras = new Map();
  }

  update(cameraId, personDetections, now = Date.now()) {
    let tracker = this.cameras.get(cameraId);
    if (!tracker) {
      tracker = new CameraPersonTracker(this.options);
      this.cameras.set(cameraId, tracker);
    }
    return tracker.update(personDetections, now);
  }
}

module.exports = { CameraPersonTracker, MultiCameraTracker };
