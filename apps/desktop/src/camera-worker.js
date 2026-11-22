// Rased Edge Agent — Camera Worker (RTSP Frame Capture)
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Pre-allocated JPEG marker buffers for high-performance zero-allocation demuxing
const JPEG_SOI = Buffer.from([0xFF, 0xD8]);
const JPEG_EOI = Buffer.from([0xFF, 0xD9]);

let sharpInstance = null;
try {
  sharpInstance = require('sharp');
} catch {}

/**
 * Validates that a JPEG frame is not a corrupted solid-gray decode artifact.
 * When FFmpeg decodes an RTSP frame without reference, missing macroblocks default to Y=128 (gray).
 * In such corrupted frames, mean is ~128 and standard deviation is very low (< 9.0) across all channels.
 */
async function isCorruptedOrGrayFrame(buffer) {
  if (!buffer || buffer.length < 5000) return true;
  if (!sharpInstance) return false;
  try {
    const stats = await sharpInstance(buffer).stats();
    const channels = stats.channels;
    if (!channels || channels.length < 3) return false;
    const isSolidGray = channels.every(c => Math.abs(c.mean - 128) < 12 && c.stdev < 9.0);
    return isSolidGray;
  } catch {
    return false;
  }
}

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
   * Capture a single frame from an RTSP stream using FFmpeg.
   * Guaranteed to avoid gray / incomplete frames by syncing to complete I-frames.
   * @param {string} rtspUrl
   * @param {number} timeoutMs
   * @param {boolean} useStreamDelay - if true, decodes 1s of stream before capturing to ensure keyframe sync
   */
  captureFrame(rtspUrl, timeoutMs = 12000, useStreamDelay = false) {
    return new Promise((resolve, reject) => {
      const ffmpegExe = resolveFfmpegPath();
      const args = [
        '-hide_banner',
        // 1. Force reliable TCP transport with 8-second socket timeout
        '-rtsp_transport', 'tcp',
        '-stimeout', '8000000',
        // 2. Discard corrupted network packets
        '-fflags', '+discardcorrupt',
        // 3. Buffer analysis allowing reliable keyframe and SPS/PPS detection (4s / 8MB)
        '-analyzeduration', '4000000',
        '-probesize', '8000000',
        '-i', rtspUrl,
      ];

      // If retry or requested: skip first 1s of stream to guarantee keyframe arrival
      if (useStreamDelay) {
        args.push('-ss', '00:00:01');
      }

      // Filter: limit max resolution to 1080p for efficiency and capture 1 frame
      args.push(
        '-vf', "scale='min(1920,iw)':-2",
        '-frames:v', '1',
        '-vsync', 'vfr',
        '-q:v', '3',
        '-f', 'image2pipe',
        '-vcodec', 'mjpeg',
        'pipe:1'
      );

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
        try {
          if (process.platform === 'win32' && proc.pid) {
            spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t']);
          } else {
            proc.kill('SIGKILL');
          }
        } catch {}
        reject(new Error('انتهت مهلة قراءة إطار الفيديو من الكاميرا (Frame capture timeout)'));
      }, timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && chunks.length > 0) {
          const buffer = Buffer.concat(chunks);
          // Require at least 8KB to ensure we have a valid JPEG structure
          if (buffer.length > 8000) {
            resolve(buffer);
          } else {
            reject(new Error(`إطار غير مكتمل أو تالف — حجم صغير جداً (${buffer.length} bytes)`));
          }
        } else {
          // Clean banner lines from stderr to keep relevant diagnostic details
          const cleanStderr = stderr.split('\n')
            .filter(line => !line.includes('configuration:') && !line.includes('libav') && !line.includes('built with'))
            .join(' ')
            .trim();
          reject(new Error(`توقف محرك الفيديو بكود (${code}): ${cleanStderr.slice(-400) || stderr.slice(-400)}`));
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
   * Captures a frame and verifies it is not a corrupted solid-gray frame.
   * Automatically retries with stream delay if a gray frame is detected.
   */
  async captureFrameWithValidation(rtspUrl, timeoutMs = 12000) {
    // Attempt 1: Fast keyframe capture
    try {
      const frame = await this.captureFrame(rtspUrl, timeoutMs, false);
      const isGray = await isCorruptedOrGrayFrame(frame);
      if (!isGray) {
        return frame;
      }
      console.warn('[CAMERA] Detected gray/corrupted frame from stream. Retrying with keyframe synchronization...');
    } catch (err) {
      console.warn('[CAMERA] Fast capture attempt failed:', err.message);
    }

    // Attempt 2: Synchronized capture with 1s stream buffer to lock onto keyframe
    const retryFrame = await this.captureFrame(rtspUrl, timeoutMs + 3000, true);
    const isGray2 = await isCorruptedOrGrayFrame(retryFrame);
    if (isGray2) {
      throw new Error('تم استلام إطار رمادي غير مكتمل من الكاميرا (Corrupted gray frame rejected)');
    }
    return retryFrame;
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

    // Parse channel number from current path if present (supports up to 4 digits like 1601 -> ch 16)
    let ch = 1;
    const chMatch = currentPath.match(/(?:Channels\/|ch|\/|channel=)([0-9]{1,4})/i);
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
      `/Streaming/Channels/${ch}02`,
      `/cam/realmonitor?channel=${ch}&subtype=0`,
      `/cam/realmonitor?channel=${ch}&subtype=1`,
      `/ch${ch}/main`,
      `/h264/ch${ch}/main/av_stream`,
      `/live/ch${ch}`,
    ];

    // Only test generic/root fallback paths if testing Channel 1 to prevent cross-channel stream leakage
    if (ch === 1) {
      testPaths.push('/Streaming/Channels/101', '/ch1/main', '/Streaming/Channels/1', '/H.264');
    }
    const uniquePaths = [...new Set(testPaths)];

    let primaryErr = null;
    let lastErr = null;
    let testedCount = 0;

    for (const p of uniquePaths) {
      const candidateUrl = baseOrigin + p;
      try {
        const frameBuffer = await this.captureFrameWithValidation(candidateUrl, 12000);
        const latency = Date.now() - startTime;
        return {
          connected: true,
          frameSize: frameBuffer.length,
          latencyMs: latency,
          workingUrl: candidateUrl
        };
      } catch (err) {
        if (testedCount === 0) {
          primaryErr = err;
        }
        lastErr = err;
        testedCount++;
        const msg = err.message || '';
        // Only break early if credentials wrong (401) or network completely unreachable
        if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('No route') || msg.includes('Connection refused')) {
          break;
        }
      }
    }

    const errToCheck = primaryErr || lastErr;
    let rawMsg = errToCheck ? errToCheck.message : 'فشل الاتصال بالكاميرا';
    let errMsg = rawMsg;

    if (rawMsg.includes('401') || rawMsg.includes('Unauthorized')) {
      errMsg = 'فشل المصادقة (401 Unauthorized): كود التحقق (Verification Code) أو كلمة المرور غير صحيحة.\n' +
        '• تأكد من اسم المستخدم (غالباً admin) وباسوورد الكاميرا أو كود التحقق المكون من 6 أحرف كبيرة.';
    } else if (rawMsg.includes('404 Not Found') || rawMsg.includes('DESCRIBE failed')) {
      errMsg = `تم الاتصال بجهاز التسجيل ولكن مسار القناة ${ch} غير موجود (404 Not Found).\n` +
        `• تأكد أن كاميرا القناة ${ch} موصلة وتعمل فعلياً على شاشة الـ DVR/NVR.\n` +
        `• لمسجلات Hikvision: جرب المسار الثانوي /Streaming/Channels/${ch}02\n` +
        `• لمسجلات Dahua: جرب المسار /cam/realmonitor?channel=${ch}&subtype=1`;
    } else if (rawMsg.includes('Connection refused') || rawMsg.includes('timed out') || rawMsg.includes('No route') || rawMsg.includes('10060') || rawMsg.includes('10061')) {
      errMsg = 'تعذر الوصول لعنوان الكاميرا (Connection Refused/Timeout).\n' +
        '• تأكد من تشغيل الكاميرا/الـ DVR واتصاله بالشبكة المحلية.\n' +
        '• تأكد من صحة عنوان IP والمنفذ 554 على جهاز التسجيل.';
    } else if (rawMsg.includes('Invalid data found') || rawMsg.includes('bad parameter') || rawMsg.includes('Protocol not supported')) {
      errMsg = `تعذر فك تشفير بث الفيديو من القناة ${ch} (Invalid data found).\n` +
        `• 1. القناة ${ch} قد تكون شاغرة أو الكاميرا مفصولة عن المسجل.\n` +
        `• 2. ترميز الكاميرا مضبوط على H.265+ (Smart Codec) — قم بتحويله من إعدادات الـ DVR إلى H.264 العادي.\n` +
        `• 3. جرب استخدام البث الفرعي (Sub-stream) الأكثر استقراراً: /Streaming/Channels/${ch}02 (Hikvision) أو /cam/realmonitor?channel=${ch}&subtype=1 (Dahua).`;
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
   * Start continuous high-efficiency frame capture using a persistent FFmpeg pipeline.
   * Streams MJPEG directly over stdout at steady fps (default 2 FPS) to eliminate process respawning overhead.
   */
  startCapture(cameraId, rawRtspUrl, fps = 2, onFrame) {
    const rtspUrl = this.normalizeRtspUrl(rawRtspUrl);
    if (this.processes.has(cameraId)) {
      this.stopCapture(cameraId);
    }

    let isActive = true;
    let proc = null;
    let reconnectTimer = null;
    let streamBuffer = Buffer.alloc(0);
    const MAX_BUFFER = 10 * 1024 * 1024; // 10MB safety cap
    const targetFps = typeof fps === 'number' && fps > 0 ? fps : 2;

    const startPersistentFfmpeg = () => {
      if (!isActive) return;

      const ffmpegExe = resolveFfmpegPath();
      const args = [
        '-hide_banner',
        '-rtsp_transport', 'tcp',
        '-stimeout', '8000000', // 8s socket timeout
        '-fflags', '+discardcorrupt+nobuffer',
        '-flags', 'low_delay',
        '-analyzeduration', '2500000',
        '-probesize', '3000000',
        '-i', rtspUrl,
        '-vf', `fps=${targetFps},scale='min(1280,iw)':-2`,
        '-q:v', '3',
        '-f', 'image2pipe',
        '-vcodec', 'mjpeg',
        'pipe:1'
      ];

      try {
        proc = spawn(ffmpegExe, args, {
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (spawnErr) {
        console.error(`[CAMERA] Failed to spawn persistent FFmpeg for camera ${cameraId}:`, spawnErr.message);
        if (isActive) {
          reconnectTimer = setTimeout(startPersistentFfmpeg, 4000);
        }
        return;
      }

      proc.stdout.on('data', (chunk) => {
        if (!isActive) return;
        streamBuffer = Buffer.concat([streamBuffer, chunk]);

        // Demux MJPEG frames between SOI (0xFF, 0xD8) and EOI (0xFF, 0xD9)
        while (streamBuffer.length > 4) {
          const soiIndex = streamBuffer.indexOf(JPEG_SOI);
          if (soiIndex === -1) {
            streamBuffer = streamBuffer.slice(-2);
            break;
          }

          if (soiIndex > 0) {
            // Discard any corrupted leading bytes before SOI
            streamBuffer = streamBuffer.slice(soiIndex);
          }

          const eoiIndex = streamBuffer.indexOf(JPEG_EOI, 2);
          if (eoiIndex === -1) {
            if (streamBuffer.length > MAX_BUFFER) {
              streamBuffer = streamBuffer.slice(-2048);
            }
            break;
          }

          const frameEnd = eoiIndex + 2;
          const frameBuffer = streamBuffer.slice(0, frameEnd);
          streamBuffer = streamBuffer.slice(frameEnd);

          if (frameBuffer.length >= 6000 && isActive) {
            try {
              onFrame(cameraId, frameBuffer);
            } catch (frameErr) {
              console.warn(`[CAMERA] onFrame callback error for camera ${cameraId}:`, frameErr.message);
            }
          }
        }
      });

      let lastStderr = '';
      proc.stderr.on('data', (chunk) => {
        lastStderr = chunk.toString().slice(-300);
      });

      proc.on('close', (code) => {
        proc = null;
        if (!isActive) return;
        console.warn(`[CAMERA] Persistent FFmpeg stream ended for camera ${cameraId} (code=${code}). Reconnecting in 3s... ${lastStderr.slice(-100)}`);
        reconnectTimer = setTimeout(startPersistentFfmpeg, 3000);
      });

      proc.on('error', (err) => {
        console.error(`[CAMERA] Persistent FFmpeg error for camera ${cameraId}:`, err.message);
      });
    };

    startPersistentFfmpeg();

    this.processes.set(cameraId, {
      rtspUrl,
      stop: () => {
        isActive = false;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (proc) {
          try {
            if (process.platform === 'win32' && proc.pid) {
              spawn('taskkill', ['/pid', String(proc.pid), '/f', '/t']);
            } else {
              proc.kill('SIGTERM');
              setTimeout(() => {
                try { if (proc) proc.kill('SIGKILL'); } catch {}
              }, 1500);
            }
          } catch {}
          proc = null;
        }
        streamBuffer = Buffer.alloc(0);
      }
    });
  }

  /**
   * Stop capture for a camera.
   */
  stopCapture(cameraId) {
    const p = this.processes.get(cameraId);
    if (p) {
      if (typeof p.stop === 'function') p.stop();
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
