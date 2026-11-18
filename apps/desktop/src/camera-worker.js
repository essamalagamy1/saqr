// Rased Edge Agent — Camera Worker (RTSP Frame Capture)
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let ffmpegPath;
try {
  ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
} catch {
  ffmpegPath = 'ffmpeg'; // fallback to system ffmpeg
}

class CameraWorker {
  constructor() {
    this.processes = new Map();
    this.tmpDir = path.join(os.tmpdir(), 'rased-frames');
    if (!fs.existsSync(this.tmpDir)) {
      fs.mkdirSync(this.tmpDir, { recursive: true });
    }
  }

  /**
   * Capture a single frame from an RTSP stream.
   * Returns the frame as a Buffer (JPEG).
   */
  captureFrame(rtspUrl, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const args = [
        '-rtsp_transport', 'tcp',
        '-analyzeduration', '1000000',
        '-probesize', '1000000',
        '-i', rtspUrl,
        '-frames:v', '1',
        '-q:v', '2',
        '-f', 'image2pipe',
        '-vcodec', 'mjpeg',
        'pipe:1'
      ];

      const proc = spawn(ffmpegPath, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const chunks = [];
      let stderr = '';

      proc.stdout.on('data', (chunk) => chunks.push(chunk));
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('Frame capture timeout'));
      }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-200)}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Test RTSP camera connection by capturing a single frame.
   */
  async testConnection(rtspUrl) {
    const startTime = Date.now();
    const frameBuffer = await this.captureFrame(rtspUrl, 15000);
    const latency = Date.now() - startTime;
    return {
      connected: true,
      frameSize: frameBuffer.length,
      latencyMs: latency,
    };
  }

  /**
   * Start continuous frame capture at a given interval.
   */
  startCapture(cameraId, rtspUrl, intervalSeconds, onFrame) {
    if (this.processes.has(cameraId)) {
      this.stopCapture(cameraId);
    }

    const captureLoop = async () => {
      try {
        const frame = await this.captureFrame(rtspUrl);
        onFrame(cameraId, frame);
      } catch (err) {
        onFrame(cameraId, null, err);
      }
    };

    // Run immediately then at interval
    captureLoop();
    const timer = setInterval(captureLoop, intervalSeconds * 1000);
    this.processes.set(cameraId, { timer, rtspUrl });
  }

  /**
   * Stop capture for a camera.
   */
  stopCapture(cameraId) {
    const proc = this.processes.get(cameraId);
    if (proc) {
      clearInterval(proc.timer);
      this.processes.delete(cameraId);
    }
  }

  /**
   * Stop all captures.
   */
  stopAll() {
    for (const [id] of this.processes) {
      this.stopCapture(id);
    }
  }
}

module.exports = CameraWorker;
