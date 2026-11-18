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

  mainWindow.on('close', (e) => {
    if (store.get('minimizeToTray') && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function getIconPath() {
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  return path.join(__dirname, '..', 'assets', iconName);
}

function createTray() {
  const iconPath = getIconPath();
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    trayIcon = nativeImage.createEmpty();
  }
  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'فتح صَقْر', click: () => {
      if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    }},
    { type: 'separator' },
    { label: 'بدء المراقبة', click: () => startAgent() },
    { label: 'إيقاف المراقبة', click: () => stopAgent() },
    { type: 'separator' },
    { label: 'خروج', click: () => { app.isQuitting = true; app.quit(); }}
  ]);

  tray.setToolTip('Saqr Edge Agent — صَقْر');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
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
ipcMain.handle('config:set', (_, key, value) => { store.set(key, value); return true; });
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

// Camera management
ipcMain.handle('cameras:list', () => store.get('cameras', []));
ipcMain.handle('cameras:add', (_, camera) => {
  if (!camera || typeof camera !== 'object') throw new Error('بيانات الكاميرا غير صالحة');
  if (!isValidStreamUrl(camera.rtspUrl)) throw new Error('رابط البث غير صالح. يجب أن يبدأ بـ rtsp:// أو http://');

  const cameras = store.get('cameras', []);
  const { v4: uuidv4 } = require('uuid');
  camera.id = camera.id || uuidv4();
  camera.enabled = camera.enabled !== false;
  cameras.push(camera);
  store.set('cameras', cameras);
  return camera;
});
ipcMain.handle('cameras:remove', (_, id) => {
  const cameras = store.get('cameras', []).filter(c => c.id !== id);
  store.set('cameras', cameras);
  return true;
});
ipcMain.handle('cameras:toggle', (_, id) => {
  const cameras = store.get('cameras', []);
  const cam = cameras.find(c => c.id === id);
  if (cam) cam.enabled = !cam.enabled;
  store.set('cameras', cameras);
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
    if (store.get('autoStart')) startAgent();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (!store.get('minimizeToTray')) app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopAgent();
});
