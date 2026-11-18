// Saqr Edge Agent — One-Click In-App Auto Updater
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

class AutoUpdater {
  constructor() {
    this.isUpdating = false;
  }

  getCurrentVersion() {
    try {
      const pkgPath = path.join(__dirname, '..', 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      return pkg.version || '1.0.0';
    } catch {
      return app.getVersion() || '1.0.0';
    }
  }

  /**
   * Compares two semantic version strings (e.g. "1.1.0" > "1.0.0")
   */
  isNewerVersion(remote, local) {
    if (!remote || !local) return false;
    const rParts = remote.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const lParts = local.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);

    for (let i = 0; i < Math.max(rParts.length, lParts.length); i++) {
      const r = rParts[i] || 0;
      const l = lParts[i] || 0;
      if (r > l) return true;
      if (r < l) return false;
    }
    return false;
  }

  /**
   * Check configured server for updates
   */
  async checkForUpdates(serverUrl) {
    if (!serverUrl) {
      throw new Error('يرجى تحديد عنوان الخادم في الإعدادات أولاً');
    }

    const currentVersion = this.getCurrentVersion();
    const cleanUrl = serverUrl.replace(/\/+$/, '');
    const versionEndpoint = `${cleanUrl}/downloads/version.json`;

    return new Promise((resolve, reject) => {
      const client = versionEndpoint.startsWith('https') ? https : http;
      const req = client.get(versionEndpoint, { timeout: 8000 }, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`الخادم استجاب برمز خطأ (${res.statusCode})`));
        }

        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            const remoteVersion = data.version || '1.0.0';
            const hasUpdate = this.isNewerVersion(remoteVersion, currentVersion);

            let asarUrl = data.asarUrl;
            let zipUrl = data.zipUrl;

            // Resolve relative URLs against serverUrl
            if (asarUrl && asarUrl.startsWith('/')) asarUrl = `${cleanUrl}${asarUrl}`;
            if (zipUrl && zipUrl.startsWith('/')) zipUrl = `${cleanUrl}${zipUrl}`;

            resolve({
              hasUpdate,
              currentVersion,
              latestVersion: remoteVersion,
              releaseDate: data.releaseDate || '',
              changelog: data.changelog || [],
              asarUrl,
              zipUrl
            });
          } catch (err) {
            reject(new Error('فشل قراءة بيانات التحديث من الخادم: ' + err.message));
          }
        });
      });

      req.on('error', err => {
        reject(new Error('تعذر الاتصال بالخادم: ' + err.message));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('انتهت مهلة الاتصال بالخادم (Timeout)'));
      });
    });
  }

  /**
   * Download the latest app.asar and restart to apply update
   */
  async downloadAndApplyUpdate(asarUrl, progressCallback = null) {
    if (this.isUpdating) {
      throw new Error('عملية التحديث جارية بالفعل');
    }

    if (!asarUrl) {
      throw new Error('رابط حزمة التحديث غير متوفر');
    }

    this.isUpdating = true;
    const tempAsarPath = path.join(os.tmpdir(), `saqr-update-${Date.now()}.asar`);

    try {
      await this._downloadFile(asarUrl, tempAsarPath, progressCallback);

      // Verify file size
      const stats = fs.statSync(tempAsarPath);
      if (stats.size < 100 * 1024) { // Less than 100KB is likely an error page
        throw new Error('حزمة التحديث المحملة تالفة أو غير مكتملة');
      }

      const isPackaged = (typeof app !== 'undefined' && app) ? app.isPackaged : false;
      if (!isPackaged) {
        return {
          success: true,
          mode: 'development',
          message: 'تم تحميل التحديث بنجاح! (في بيئة التطوير لا يتم الاستبدال الحي للملفات).'
        };
      }

      // In packaged Electron, resources are at process.resourcesPath
      const liveAsarPath = path.join(process.resourcesPath, 'app.asar');
      const exePath = process.execPath;

      if (process.platform === 'win32') {
        const batPath = path.join(os.tmpdir(), `saqr_apply_update_${Date.now()}.bat`);
        const batContent = `@echo off
chcp 65001 >nul
echo [Saqr Edge Agent] Updating application to latest version...
timeout /t 2 /nobreak >nul

copy /y "${tempAsarPath}" "${liveAsarPath}" >nul
if errorlevel 1 (
  timeout /t 2 /nobreak >nul
  copy /y "${tempAsarPath}" "${liveAsarPath}" >nul
)

del "${tempAsarPath}" >nul 2>&1
start "" "${exePath}"
(goto) 2>nul & del "%~f0"
`;
        fs.writeFileSync(batPath, batContent, 'utf8');

        // Spawn detached process
        const child = spawn('cmd.exe', ['/c', batPath], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        child.unref();

        // Exit immediately so file locks are freed
        setTimeout(() => {
          app.exit(0);
        }, 500);

        return { success: true, message: 'جاري تطبيق التحديث وإعادة تشغيل التطبيق...' };
      } else {
        // Linux / macOS fallback
        const shPath = path.join(os.tmpdir(), `saqr_apply_update_${Date.now()}.sh`);
        const shContent = `#!/bin/sh
sleep 2
cp -f "${tempAsarPath}" "${liveAsarPath}"
rm -f "${tempAsarPath}"
"${exePath}" &
rm -f "$0"
`;
        fs.writeFileSync(shPath, shContent, { mode: 0o755 });
        const child = spawn('/bin/sh', [shPath], { detached: true, stdio: 'ignore' });
        child.unref();

        setTimeout(() => {
          app.exit(0);
        }, 500);

        return { success: true, message: 'جاري تطبيق التحديث وإعادة تشغيل التطبيق...' };
      }
    } finally {
      this.isUpdating = false;
    }
  }

  _downloadFile(url, destPath, progressCallback) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath);
      const client = url.startsWith('https') ? https : http;

      const handleResponse = (res) => {
        // Handle HTTP 301 / 302 redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let redirectUrl = res.headers.location;
          if (redirectUrl.startsWith('/')) {
            const urlObj = new URL(url);
            redirectUrl = `${urlObj.origin}${redirectUrl}`;
          }
          const nextClient = redirectUrl.startsWith('https') ? https : http;
          return nextClient.get(redirectUrl, handleResponse).on('error', reject);
        }

        if (res.statusCode !== 200) {
          file.close();
          try { fs.unlinkSync(destPath); } catch {}
          return reject(new Error(`فشل تحميل التحديث (HTTP ${res.statusCode})`));
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;

        res.on('data', chunk => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0 && progressCallback) {
            const percent = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100));
            progressCallback({
              percent,
              downloadedBytes,
              totalBytes,
              downloadedMB: (downloadedBytes / (1024 * 1024)).toFixed(1),
              totalMB: (totalBytes / (1024 * 1024)).toFixed(1)
            });
          }
        });

        res.pipe(file);

        file.on('finish', () => {
          file.close(() => resolve());
        });
      };

      const req = client.get(url, handleResponse);
      req.on('error', err => {
        file.close();
        try { fs.unlinkSync(destPath); } catch {}
        reject(err);
      });
    });
  }
}

module.exports = AutoUpdater;
