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
   * Tests fallback paths and provides helpful diagnostic errors.
   */
  async testConnection(rawUrl) {
    let rtspUrl = this.normalizeRtspUrl(rawUrl);
    const startTime = Date.now();

    // Candidate stream paths if user provided root or specific path fails
    const match = rtspUrl.match(/^(rtsp[s]?:\/\/[^\/]+)(\/.*)?$/i);
    const baseOrigin = match ? match[1] : rtspUrl;
    const currentPath = match && match[2] ? match[2] : '/ch1/main';

    const testPaths = [
      currentPath,
      '/ch1/main',
      '/h264/ch1/main/av_stream',
      '/Streaming/Channels/101',
      '/H.264'
    ];
    const uniquePaths = [...new Set(testPaths)];

    let lastErr = null;
    for (const p of uniquePaths) {
      const candidateUrl = baseOrigin + p;
      try {
        const frameBuffer = await this.captureFrame(candidateUrl, 8000);
        const latency = Date.now() - startTime;
        return {
          connected: true,
          frameSize: frameBuffer.length,
          latencyMs: latency,
          workingUrl: candidateUrl
        };
      } catch (err) {
        lastErr = err;
        // If 401 Unauthorized or timeout/unreachable, other paths won't change auth or network reachability
        const msg = err.message || '';
        if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('timed out') || msg.includes('No route') || msg.includes('Connection refused')) {
          break;
        }
      }
    }

    let errMsg = lastErr ? lastErr.message : 'فشل الاتصال بالكاميرا';
    if (errMsg.includes('404 Not Found') || errMsg.includes('DESCRIBE failed')) {
      errMsg = 'تم الاتصال بالكاميرا ولكن تم رفض مسار البث (404 Not Found).\n' +
        'لكاميرات EZVIZ: تأكد من تفعيل RTSP وإيقاف "تشفير الفيديو" من تطبيق EZVIZ على الهاتف:\n' +
        '(الملف الشخصي > الإعدادات > العرض المباشر للشبكة المحلية LAN Live View > بدء الفحص > إعدادات الكاميرا > إعدادات الخدمة المحلية > تفعيل RTSP).';
    } else if (errMsg.includes('401') || errMsg.includes('Unauthorized')) {
      errMsg = 'فشل المصادقة (401 Unauthorized): كود التحقق (Verification Code) أو كلمة المرور غير صحيحة.\n' +
        'يرجى التأكد من كود التحقق المكون من 6 أحرف إنجليزية كبيرة والمكتوب أسفل الكاميرا.';
    } else if (errMsg.includes('Connection refused') || errMsg.includes('timed out') || errMsg.includes('No route')) {
      errMsg = 'تعذر الوصول لعنوان الكاميرا (Connection Refused/Timeout).\n' +
        'يرجى التأكد من تشغيل الكاميرا واتصالها بنفس شبكة الواي فاي وصحة عنوان الـ IP والمنفذ 554.';
    }

    throw new Error(errMsg);
  }

  /**
   * Ensure RTSP URL has default stream path if omitted
   */
  normalizeRtspUrl(url) {
    if (!url || typeof url !== 'string') return url;
    let clean = url.trim();
    const m = clean.match(/^(rtsp[s]?:\/\/[^\/]+)(\/)?$/i);
    if (m) {
      clean = m[1] + '/ch1/main';
    }
    return clean;
  }

  /**
   * Start continuous frame capture at a given interval.
   */
  startCapture(cameraId, rawRtspUrl, intervalSeconds, onFrame) {
    const rtspUrl = this.normalizeRtspUrl(rawRtspUrl);
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
