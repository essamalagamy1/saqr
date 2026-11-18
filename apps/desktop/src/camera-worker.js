// Rased Edge Agent — Camera Worker (RTSP Frame Capture)
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

/**
 * Resolves the absolute path to the bundled or system FFmpeg binary.
 * Handles packaged Electron (.asar / asar.unpacked / extraResources / AppData fallback).
 */
function resolveFfmpegPath() {
  const isWin = process.platform === 'win32';
  const binaryName = isWin ? 'ffmpeg.exe' : 'ffmpeg';

  // 1. Packaged Electron extraResources (e.g. resources/bin/ffmpeg.exe)
  if (process.resourcesPath) {
    const directBin = path.join(process.resourcesPath, 'bin', binaryName);
    if (fs.existsSync(directBin)) return directBin;

    const rootBin = path.join(process.resourcesPath, binaryName);
    if (fs.existsSync(rootBin)) return rootBin;

    // Check asar.unpacked
    const unpacked = path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      '@ffmpeg-installer',
      `${process.platform}-${process.arch}`,
      binaryName
    );
    if (fs.existsSync(unpacked)) return unpacked;

    if (isWin) {
      const unpackedWin = path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        '@ffmpeg-installer',
        'win32-x64',
        'ffmpeg.exe'
      );
      if (fs.existsSync(unpackedWin)) return unpackedWin;
    }
  }

  // 2. Check userData/bin/ffmpeg.exe (extracted for in-app updates)
  let userDataBin = null;
  try {
    const electron = require('electron');
    const electronApp = electron.app || (electron.remote && electron.remote.app);
    if (electronApp && typeof electronApp.getPath === 'function') {
      const userData = electronApp.getPath('userData');
      userDataBin = path.join(userData, 'bin', binaryName);
      if (fs.existsSync(userDataBin) && fs.statSync(userDataBin).size > 5 * 1024 * 1024) {
        return userDataBin;
      }
    }
  } catch {}

  // 3. Try to unpack from bundled asset into userData/bin if on Windows
  if (isWin && userDataBin) {
    const possibleBundled = [
      path.join(__dirname, '..', 'assets', 'bin', 'ffmpeg.exe'),
      path.join(__dirname, '..', 'node_modules', '@ffmpeg-installer', 'win32-x64', 'ffmpeg.exe')
    ];
    for (const src of possibleBundled) {
      try {
        if (fs.existsSync(src)) {
          const binDir = path.dirname(userDataBin);
          if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
          const buf = fs.readFileSync(src);
          fs.writeFileSync(userDataBin, buf);
          return userDataBin;
        }
      } catch (err) {
        console.error('Failed to unpack ffmpeg to userData:', err);
      }
    }
  }

  // 4. Try @ffmpeg-installer/ffmpeg
  try {
    let p = require('@ffmpeg-installer/ffmpeg').path;
    if (p) {
      const unpackedP = p.replace('app.asar', 'app.asar.unpacked');
      if (fs.existsSync(unpackedP)) return unpackedP;
      if (fs.existsSync(p)) return p;
    }
  } catch {}

  // 5. Check relative paths from project root
  const candidates = [
    path.resolve(__dirname, '..', 'assets', 'bin', binaryName),
    path.resolve(__dirname, '..', 'node_modules', '@ffmpeg-installer', `${process.platform}-${process.arch}`, binaryName),
    path.resolve(__dirname, '..', 'node_modules', '@ffmpeg-installer', 'win32-x64', 'ffmpeg.exe')
  ];
  for (const cand of candidates) {
    if (fs.existsSync(cand)) return cand;
  }

  // 6. Fallback to system command
  return binaryName;
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
      const ffmpegExe = resolveFfmpegPath();
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

      let proc;
      try {
        proc = spawn(ffmpegExe, args, {
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (spawnErr) {
        return reject(new Error(`تعذر تشغيل محرك الفيديو FFmpeg (${ffmpegExe}): ${spawnErr.message}`));
      }

      const chunks = [];
      let stderr = '';

      proc.stdout.on('data', (chunk) => chunks.push(chunk));
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
        reject(new Error('انتهت مهلة قراءة إطار الفيديو من الكاميرا (Frame capture timeout)'));
      }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        } else {
          reject(new Error(`توقف محرك الفيديو بكود (${code}): ${stderr.slice(-200)}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        if (err.code === 'ENOENT') {
          reject(new Error(`لم يتم العثور على محرك تشغيل الفيديو FFmpeg في المسار (${ffmpegExe})`));
        } else {
          reject(err);
        }
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
    const currentPath = match && match[2] ? match[2] : '/Streaming/Channels/101';

    // Parse channel number from current path if present
    let ch = 1;
    const chMatch = currentPath.match(/(?:Channels\/|ch|\/|channel=)([0-9]{1,3})/i);
    if (chMatch) {
      const parsed = parseInt(chMatch[1], 10);
      if (parsed >= 100) {
        ch = Math.floor(parsed / 100);
      } else if (parsed >= 1 && parsed <= 64) {
        ch = parsed;
      }
    }

    const testPaths = [
      currentPath,
      `/Streaming/Channels/${ch}01`,
      `/ch${ch}/main`,
      `/Streaming/Channels/${ch}02`,
      `/h264/ch${ch}/main/av_stream`,
      `/cam/realmonitor?channel=${ch}&subtype=0`,
      `/live/ch${ch}`,
      '/Streaming/Channels/101',
      '/ch1/main',
      '/Streaming/Channels/1',
      '/H.264'
    ];
    const uniquePaths = [...new Set(testPaths)];

    let lastErr = null;
    for (const p of uniquePaths) {
      const candidateUrl = baseOrigin + p;
      try {
        const frameBuffer = await this.captureFrame(candidateUrl, 4500);
        const latency = Date.now() - startTime;
        return {
          connected: true,
          frameSize: frameBuffer.length,
          latencyMs: latency,
          workingUrl: candidateUrl
        };
      } catch (err) {
        lastErr = err;
        const msg = err.message || '';
        // Only break early if credentials wrong (401) or network completely unreachable
        if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('No route') || msg.includes('Connection refused')) {
          break;
        }
      }
    }

    let errMsg = lastErr ? lastErr.message : 'فشل الاتصال بالكاميرا';
    if (errMsg.includes('404 Not Found') || errMsg.includes('DESCRIBE failed')) {
      errMsg = 'تم الاتصال بالكاميرا ولكن تم رفض مسار البث (404 Not Found).\n' +
        'لكاميرات ومسجلات Hikvision/EZVIZ: مسار البث القياسي هو /Streaming/Channels/101 (أو 201 للقناة 2).\n' +
        'لكاميرات EZVIZ: تأكد من تفعيل RTSP وإيقاف "تشفير الفيديو" من تطبيق EZVIZ على الهاتف.';
    } else if (errMsg.includes('401') || errMsg.includes('Unauthorized')) {
      errMsg = 'فشل المصادقة (401 Unauthorized): كود التحقق (Verification Code) أو كلمة المرور غير صحيحة.\n' +
        'يرجى التأكد من كلمة المرور أو كود التحقق المكون من 6 أحرف إنجليزية كبيرة والمكتوب أسفل الكاميرا.';
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
      clean = m[1] + '/Streaming/Channels/101';
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
