// Saqr Edge Agent — Preload Script (IPC Bridge)
const { contextBridge, ipcRenderer } = require('electron');

const saqrBridge = {
  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },

  // Config
  config: {
    get: (key) => ipcRenderer.invoke('config:get', key),
    set: (key, value) => ipcRenderer.invoke('config:set', key, value),
    getAll: () => ipcRenderer.invoke('config:getAll'),
  },

  // Connection
  connection: {
    test: (serverUrl, email, password) =>
      ipcRenderer.invoke('connection:test', serverUrl, email, password),
  },

  // Setup
  setup: {
    complete: (config) => ipcRenderer.invoke('setup:complete', config),
  },

  // Cameras
  cameras: {
    list: () => ipcRenderer.invoke('cameras:list'),
    add: (camera) => ipcRenderer.invoke('cameras:add', camera),
    remove: (id) => ipcRenderer.invoke('cameras:remove', id),
    toggle: (id) => ipcRenderer.invoke('cameras:toggle', id),
    update: (id, updates) => ipcRenderer.invoke('cameras:update', id, updates),
    test: (rtspUrl) => ipcRenderer.invoke('cameras:test', rtspUrl),
    fetchFromServer: () => ipcRenderer.invoke('cameras:fetchFromServer'),
    scanNetwork: () => ipcRenderer.invoke('cameras:scanNetwork'),
  },

  // Agent
  agent: {
    start: () => ipcRenderer.invoke('agent:start'),
    stop: () => ipcRenderer.invoke('agent:stop'),
    status: () => ipcRenderer.invoke('agent:status'),
  },

  // Auto Updater
  updater: {
    getVersion: () => ipcRenderer.invoke('updater:getVersion'),
    check: () => ipcRenderer.invoke('updater:check'),
    apply: (asarUrl) => ipcRenderer.invoke('updater:apply', asarUrl),
  },

  // Screenshot helper for verification
  captureScreenshot: (path) => ipcRenderer.invoke('app:captureScreenshot', path),

  // Navigation
  navigate: (page) => ipcRenderer.send('navigate', page),

  // Shell
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },

  // Events
  on: (channel, callback) => {
    const validChannels = ['agent:detection', 'agent:status', 'updater:progress'];
    if (validChannels.includes(channel)) {
      const listener = (_, data) => callback(data);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    }
  },
};

contextBridge.exposeInMainWorld('saqr', saqrBridge);
contextBridge.exposeInMainWorld('rased', saqrBridge);
