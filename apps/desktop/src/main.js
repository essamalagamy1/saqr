// Rased Edge Agent — Electron Main Process
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');

// Config store
const store = new Store({
  schema: {
    serverUrl: { type: 'string', default: '' },
    email: { type: 'string', default: '' },
    accessToken: { type: 'string', default: '' },
    refreshToken: { type: 'string', default: '' },
    companyId: { type: 'string', default: '' },
    cameras: { type: 'array', default: [], items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        rtspUrl: { type: 'string' },
        enabled: { type: 'boolean', default: true }
      }
    }},
    detectionInterval: { type: 'number', default: 3 },
    autoStart: { type: 'boolean', default: false },
    minimizeToTray: { type: 'boolean', default: true },
    setupComplete: { type: 'boolean', default: false }
  }
});

let mainWindow = null;
let setupWindow = null;
let tray = null;
let agentWorker = null;

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 580,
    height: 720,
    resizable: false,
    frame: false,
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Security Hardening: Prevent opening external popups or navigating away
  setupWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  setupWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  setupWindow.loadFile(path.join(__dirname, '..', 'renderer', 'setup.html'));
  setupWindow.on('closed', () => { setupWindow = null; });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Security Hardening: Prevent opening external popups or navigating away
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'main.html'));

  let hasShownTrayBalloon = false;

  mainWindow.on('close', (e) => {
    // If user clicked close button (X), hide to system tray instead of exiting
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();

      // Show balloon notification so the user knows monitoring is running in background
      if (process.platform === 'win32' && tray && !hasShownTrayBalloon) {
        hasShownTrayBalloon = true;
        try {
          tray.displayBalloon({
            title: 'صَقْر — المراقبة مستمرة في الخلفية',
            content: 'تم تصغير صقر إلى شريط المهام بجوار الساعة، ومراقبة الكاميرات والذكاء الاصطناعي مستمرة في العمل.',
          });
        } catch {}
      }
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function getIconPath() {
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  return path.join(__dirname, '..', 'assets', iconName);
}

function createTray() {
  if (tray) return;

  const iconPath = getIconPath();
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
  } catch {
    trayIcon = nativeImage.createEmpty();
  }
  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'فتح صَقْر Edge Agent',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'بدء المراقبة الحية',
      click: () => startAgent()
    },
    {
      label: 'إيقاف المراقبة',
      click: () => stopAgent()
    },
    { type: 'separator' },
    {
      label: 'خروج نهائي من التطبيق',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Saqr Edge Agent — المراقبة في الخلفية نشطة');
  tray.setContextMenu(contextMenu);

  // Single-click restores window on Windows
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  // Double-click also restores window
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ===== Agent Control =====
function startAgent() {
  if (agentWorker) return;
  const AgentRunner = require('./agent-runner');
  agentWorker = new AgentRunner(store, (event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('agent:detection', event);
    }
  });
  agentWorker.start();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('agent:status', { running: true });
  }
}

function stopAgent() {
  if (agentWorker) {
    agentWorker.stop();
    agentWorker = null;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('agent:status', { running: false });
  }
}

function reloadAgentIfRunning() {
  if (agentWorker && agentWorker.running) {
    try {
      agentWorker.reloadCameras();
    } catch (err) {
      console.warn('[AGENT] Failed to reload cameras:', err.message);
    }
  }
}

// ===== IPC Handlers =====

// Window controls
ipcMain.on('window:minimize', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.minimize();
});
ipcMain.on('window:maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win?.isMaximized()) win.unmaximize(); else win?.maximize();
});
ipcMain.on('window:close', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.close();
});

// Config
ipcMain.handle('config:get', (_, key) => store.get(key));
ipcMain.handle('config:set', (_, key, value) => {
  store.set(key, value);
  if (key === 'autoStart') {
    try {
      app.setLoginItemSettings({
        openAtLogin: !!value,
        path: process.execPath,
        args: ['--hidden'],
      });
    } catch {}
  }
  return true;
});
ipcMain.handle('config:getAll', () => store.store);

// Connection test
ipcMain.handle('connection:test', async (_, serverUrl, email, password) => {
  const ApiClient = require('./api-client');
  const client = new ApiClient(serverUrl);
  try {
    const result = await client.login(email, password);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Setup complete
ipcMain.handle('setup:complete', async (_, config) => {
  store.set('serverUrl', config.serverUrl);
  store.set('email', config.email);
  store.set('accessToken', config.accessToken);
  store.set('refreshToken', config.refreshToken);
  store.set('companyId', config.companyId);
  store.set('setupComplete', true);

  if (setupWindow) setupWindow.close();
  createMainWindow();
  createTray();
  if (store.get('autoStart')) startAgent();
  return true;
});

function isValidStreamUrl(str) {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim();
  return s.startsWith('rtsp://') || s.startsWith('rtsps://') || s.startsWith('http://') || s.startsWith('https://');
}

function deduplicateCameras(cameras) {
  if (!Array.isArray(cameras)) return [];
  const seenIds = new Set();
  const seenUrls = new Set();
  const unique = [];

  for (const c of cameras) {
    if (!c || !c.id) continue;
    // Normalize URL for comparison (ignore credentials when comparing endpoints)
    const urlClean = (c.rtspUrl || '').replace(/^rtsp[s]?:\/\/[^@]+@/i, 'rtsp://').trim().toLowerCase();
    
    if (seenIds.has(c.id)) {
      continue;
    }
    if (urlClean && seenUrls.has(urlClean)) {
      continue;
    }

    seenIds.add(c.id);
    if (urlClean) seenUrls.add(urlClean);
    unique.push(c);
  }
  return unique;
}

// Camera management
ipcMain.handle('cameras:list', () => {
  const raw = store.get('cameras', []);
  const clean = deduplicateCameras(raw);
  if (clean.length !== raw.length) {
    store.set('cameras', clean);
  }
  return clean;
});

ipcMain.handle('cameras:add', (_, camera) => {
  if (!camera || typeof camera !== 'object') throw new Error('بيانات الكاميرا غير صالحة');
  if (!isValidStreamUrl(camera.rtspUrl)) throw new Error('رابط البث غير صالح. يجب أن يبدأ بـ rtsp:// أو http://');

  const cameras = deduplicateCameras(store.get('cameras', []));
  const { v4: uuidv4 } = require('uuid');
  camera.id = camera.id || uuidv4();
  camera.enabled = camera.enabled !== false;

  const urlClean = (camera.rtspUrl || '').replace(/^rtsp[s]?:\/\/[^@]+@/i, 'rtsp://').trim().toLowerCase();

  // Find if exists by ID or by same stream endpoint
  const existingIndex = cameras.findIndex(c => {
    if (c.id === camera.id) return true;
    const cUrlClean = (c.rtspUrl || '').replace(/^rtsp[s]?:\/\/[^@]+@/i, 'rtsp://').trim().toLowerCase();
    return cUrlClean && urlClean && cUrlClean === urlClean;
  });

  if (existingIndex !== -1) {
    // Preserve existing credentials or update
    cameras[existingIndex] = {
      ...cameras[existingIndex],
      ...camera,
      id: cameras[existingIndex].id // keep stable ID
    };
  } else {
    cameras.push(camera);
  }

  store.set('cameras', cameras);
  reloadAgentIfRunning();

  // Sync added camera to Cloud API in background
  (async () => {
    try {
      const serverUrl = store.get('serverUrl');
      const token = store.get('accessToken');
      if (serverUrl && token) {
        const ApiClient = require('./api-client');
        const client = new ApiClient(serverUrl, token);
        const serverCam = await client.addCamera(camera);
        if (serverCam && serverCam.id && serverCam.id !== camera.id) {
          const currentCams = store.get('cameras', []);
          const idx = currentCams.findIndex(c => c.id === camera.id);
          if (idx !== -1) {
            currentCams[idx].id = serverCam.id;
            store.set('cameras', currentCams);
          }
        }
      }
    } catch (err) {
      console.warn('[CAMERA_SYNC] Cloud sync warning:', err.message);
    }
  })();

  return camera;
});
ipcMain.handle('cameras:remove', async (_, id) => {
  const cameras = store.get('cameras', []).filter(c => c.id !== id);
  store.set('cameras', cameras);
  reloadAgentIfRunning();

  // Sync deletion to Cloud API
  try {
    const serverUrl = store.get('serverUrl');
    const token = store.get('accessToken');
    if (serverUrl && token && id) {
      const ApiClient = require('./api-client');
      const client = new ApiClient(serverUrl, token);
      await client.deleteCamera(id).catch(() => {});
    }
  } catch {}

  return true;
});
ipcMain.handle('cameras:toggle', (_, id) => {
  const cameras = store.get('cameras', []);
  const cam = cameras.find(c => c.id === id);
  if (cam) cam.enabled = !cam.enabled;
  store.set('cameras', cameras);
  reloadAgentIfRunning();
  return cam;
});
ipcMain.handle('cameras:update', (_, id, updates) => {
  if (!updates || typeof updates !== 'object') throw new Error('بيانات التحديث غير صالحة');
  if (updates.rtspUrl && !isValidStreamUrl(updates.rtspUrl)) {
    throw new Error('رابط البث غير صالح');
  }
  const cameras = store.get('cameras', []);
  const index = cameras.findIndex(c => c.id === id);
  if (index !== -1) {
    cameras[index] = { ...cameras[index], ...updates };
    store.set('cameras', cameras);
  reloadAgentIfRunning();

    // Sync updated camera to cloud API
    (async () => {
      try {
        const serverUrl = store.get('serverUrl');
        const token = store.get('accessToken');
        if (serverUrl && token) {
          const ApiClient = require('./api-client');
          const client = new ApiClient(serverUrl, token);
          await client.addCamera(cameras[index]);
        }
      } catch (err) {
        console.warn('[CAMERA_SYNC] Failed to sync updated camera to cloud:', err.message);
      }
    })();

    return cameras[index];
  }
  throw new Error('الكاميرا غير موجودة');
});
ipcMain.handle('cameras:test', async (_, rtspUrl) => {
  if (!isValidStreamUrl(rtspUrl)) {
    return { success: false, error: 'رابط RTSP غير صالح' };
  }
  const CameraWorker = require('./camera-worker');
  const worker = new CameraWorker();
  try {
    const result = await worker.testConnection(rtspUrl);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Fetch cameras from cloud API
ipcMain.handle('cameras:fetchFromServer', async () => {
  const ApiClient = require('./api-client');
  const client = new ApiClient(store.get('serverUrl'), store.get('accessToken'));
  try {
    const cameras = await client.getCameras();
    return { success: true, data: cameras };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Fetch branches from cloud API
ipcMain.handle('branches:list', async () => {
  const ApiClient = require('./api-client');
  const client = new ApiClient(store.get('serverUrl'), store.get('accessToken'));
  try {
    const branches = await client.getBranches();
    return { success: true, data: branches };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Connect directly to DVR / NVR and extract all channels & metadata
ipcMain.handle('dvr:connect-and-fetch', async (_, config) => {
  const dvrConnector = require('./dvr-connector');
  try {
    const result = await dvrConnector.extractDvrChannels(config || {});
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Bulk sync all local cameras to cloud API
ipcMain.handle('cameras:syncAllToCloud', async () => {
  const serverUrl = store.get('serverUrl');
  let token = store.get('accessToken');
  const refreshToken = store.get('refreshToken');
  if (!serverUrl || !token) {
    return { success: false, error: 'غير متصل بالخادم أو لم يتم تسجيل الدخول. يرجى ضبط الرابط وتسجيل الدخول من إعدادات الخادم.' };
  }

  const ApiClient = require('./api-client');
  const client = new ApiClient(serverUrl, token);
  let localCameras = store.get('cameras', []);

  if (localCameras.length === 0) {
    return { success: true, count: 0, message: 'لا توجد كاميرات محلية للمزامنة' };
  }

  let syncedCount = 0;
  let lastError = '';
  for (const cam of localCameras) {
    try {
      const serverCam = await client.addCamera(cam);
      if (serverCam && serverCam.id) {
        cam.id = serverCam.id;
        cam.branch_id = serverCam.branch_id || cam.branch_id;
      }
      syncedCount++;
    } catch (err) {
      lastError = err.message || String(err);
      console.warn(`[SYNC] Failed to sync camera ${cam.name}:`, lastError);

      // If 401 Unauthorized, attempt automatic token refresh
      if ((lastError.includes('401') || lastError.toLowerCase().includes('token')) && refreshToken) {
        try {
          const refreshed = await client.refreshToken(refreshToken);
          if (refreshed && refreshed.accessToken) {
            token = refreshed.accessToken;
            store.set('accessToken', token);
            client.accessToken = token;

            // Retry syncing this camera
            const serverCam = await client.addCamera(cam);
            if (serverCam && serverCam.id) {
              cam.id = serverCam.id;
              cam.branch_id = serverCam.branch_id || cam.branch_id;
            }
            syncedCount++;
            lastError = '';
          }
        } catch (refreshErr) {
          console.warn('[SYNC] Auto-refresh failed:', refreshErr.message);
        }
      }
    }
  }

  if (syncedCount === 0 && localCameras.length > 0) {
    return {
      success: false,
      count: 0,
      total: localCameras.length,
      error: `فشلت مزامنة الكاميرات مع المنصة: ${lastError || 'تعذر الاتصال بالخادم'}. تأكد من صحة رابط الخادم وحالة تسجيل الدخول.`
    };
  }

  // After pushing local cameras, merge remote configurations (roles, zones, etc.) from server
  try {
    const serverCams = await client.getCameras();
    if (Array.isArray(serverCams) && serverCams.length > 0) {
      const serverCamMap = new Map(serverCams.map(s => [s.id, s]));
      localCameras = localCameras.map(cam => {
        const remote = serverCamMap.get(cam.id);
        if (!remote) return cam;
        return {
          ...cam,
          config: remote.config ?? cam.config,
          zone_type: remote.zone_type ?? cam.zone_type,
          zone_name: remote.zone_name ?? cam.zone_name,
          branch_id: remote.branch_id ?? cam.branch_id,
        };
      });
    }
  } catch (err) {
    console.warn('[SYNC] Post-sync camera config merge warning:', err.message);
  }

  store.set('cameras', localCameras);
  reloadAgentIfRunning();
  return {
    success: true,
    count: syncedCount,
    total: localCameras.length,
    message: syncedCount === localCameras.length
      ? `تمت مزامنة جميع الكاميرات (${syncedCount} كاميرا) مع المنصة بنجاح!`
      : `تمت مزامنة ${syncedCount} من إجمالي ${localCameras.length} كاميرا مع المنصة.`
  };
});

// Local HTTP API on port 18800 for Web Dashboard direct sync
try {
  const http = require('http');
  const localServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (req.url === '/api/cameras' && req.method === 'GET') {
      const cams = store.get('cameras', []);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, cameras: cams }));
    }

    // Delete single camera by ID or channel
    if (req.url.startsWith('/api/cameras/') && req.method === 'DELETE') {
      const targetId = decodeURIComponent(req.url.replace(/^\/api\/cameras\//, '').split('?')[0]);
      const currentCams = store.get('cameras', []);
      const filtered = currentCams.filter(c => c.id !== targetId && c.dvrChannel !== targetId && c.name !== targetId);
      store.set('cameras', filtered);
      reloadAgentIfRunning();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: 'Camera deleted from agent', remaining: filtered.length }));
    }

    // Delete all cameras from local agent
    if (req.url === '/api/cameras' && req.method === 'DELETE') {
      store.set('cameras', []);
      reloadAgentIfRunning();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: 'All local cameras deleted from agent' }));
    }

    if (req.url.startsWith('/api/cameras/snapshot') && req.method === 'GET') {
      const parsedUrl = new URL(req.url, 'http://127.0.0.1:18800');
      const camId = parsedUrl.searchParams.get('id');
      const camIp = parsedUrl.searchParams.get('ip');
      const cams = store.get('cameras', []);
      const cam = cams.find(c => (camId && c.id === camId) || (camIp && c.rtspUrl && c.rtspUrl.includes(camIp)));
      if (cam && cam.rtspUrl) {
        try {
          const CameraWorker = require('./camera-worker');
          const worker = new CameraWorker();
          const frame = await worker.captureFrame(cam.rtspUrl, 5000);
          res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          });
          return res.end(frame);
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: e.message }));
        }
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Camera not found' }));
    }

    if (req.url === '/api/sync' && req.method === 'POST') {
      const serverUrl = store.get('serverUrl');
      const token = store.get('accessToken');
      let syncedCount = 0;
      if (serverUrl && token) {
        const ApiClient = require('./api-client');
        const client = new ApiClient(serverUrl, token);
        const cams = store.get('cameras', []);
        for (const cam of cams) {
          try {
            await client.addCamera(cam);
            syncedCount++;
          } catch {}
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, count: syncedCount }));
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  localServer.listen(18800, '0.0.0.0', () => {
    console.log('[AGENT_HTTP] Local API listening on port 18800');
  });
  localServer.on('error', (e) => {
    console.warn('[AGENT_HTTP] Local server info/warning:', e.message);
  });
} catch (e) {
  console.warn('[AGENT_HTTP] Could not start local server:', e.message);
}

// Auto-scan local network cameras (SADP, ONVIF, RTSP port sweep)
const CameraScanner = require('./camera-scanner');
const cameraScanner = new CameraScanner();

ipcMain.handle('cameras:scanNetwork', async () => {
  try {
    const results = await cameraScanner.scanNetwork();
    return { success: true, cameras: results };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Auto-Updater
const AutoUpdater = require('./auto-updater');
const autoUpdater = new AutoUpdater();

ipcMain.handle('updater:getVersion', () => autoUpdater.getCurrentVersion());

ipcMain.handle('updater:check', async () => {
  try {
    const serverUrl = store.get('serverUrl') || 'http://127.0.0.1:3000';
    const result = await autoUpdater.checkForUpdates(serverUrl);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('updater:apply', async (_, asarUrl) => {
  try {
    const result = await autoUpdater.downloadAndApplyUpdate(asarUrl, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:progress', progress);
      }
    });
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Agent control
ipcMain.handle('agent:start', () => { startAgent(); return true; });
ipcMain.handle('agent:stop', () => { stopAgent(); return true; });
ipcMain.handle('agent:status', () => ({ running: !!agentWorker }));

ipcMain.handle('app:captureScreenshot', async (_, filepath) => {
  const win = mainWindow || setupWindow;
  if (win && !win.isDestroyed()) {
    const img = await win.webContents.capturePage();
    require('fs').writeFileSync(filepath, img.toPNG());
    return true;
  }
  return false;
});

// Open external link safely (only allow http & https)
ipcMain.handle('shell:openExternal', (_, rawUrl) => {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return shell.openExternal(rawUrl);
    }
  } catch {}
  return false;
});

// Navigate to page
ipcMain.on('navigate', (_, page) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', `${page}.html`));
  }
});

// ===== App Lifecycle =====
app.whenReady().then(() => {
  if (!store.get('setupComplete')) {
    createSetupWindow();
  } else {
    createMainWindow();
    createTray();
    // Always start background camera capture & AI processing
    startAgent();
  }
});

app.on('window-all-closed', () => {
  // Stay running in system tray background unless user explicitly clicked 'خروج نهائي'
  if (app.isQuitting) {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopAgent();
});
