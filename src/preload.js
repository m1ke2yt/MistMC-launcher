'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  pickDir: () => ipcRenderer.invoke('pick-dir'),
  launch: (opts) => ipcRenderer.invoke('launch-game', opts),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  minimize: () => ipcRenderer.send('window-min'),
  close: () => ipcRenderer.send('window-close'),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, d) => cb(d)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, d) => cb(d)),
  onLog: (cb) => ipcRenderer.on('log', (_e, d) => cb(d)),
  onState: (cb) => ipcRenderer.on('state', (_e, d) => cb(d)),
  onLaunchError: (cb) => ipcRenderer.on('launch-error', (_e, d) => cb(d)),
});
