'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

function listener(channel, callback) {
  const wrapped = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('orbit', {
  getState: () => ipcRenderer.invoke('state:get'),
  pickFiles: () => ipcRenderer.invoke('dialog:files'),
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  pickDownloadFolder: () => ipcRenderer.invoke('dialog:download'),
  pathsFromFiles: (files) => Array.from(files || []).map((file) => webUtils.getPathForFile(file)).filter(Boolean),
  startPairing: () => ipcRenderer.invoke('pairing:start'),
  stopPairing: () => ipcRenderer.invoke('pairing:stop'),
  pairDevice: (id, code) => ipcRenderer.invoke('device:pair', id, code),
  probeDevice: (address) => ipcRenderer.invoke('device:probe', address),
  updateDevice: (id, changes) => ipcRenderer.invoke('device:update', id, changes),
  removeDevice: (id) => ipcRenderer.invoke('device:remove', id),
  sendPaths: (id, paths) => ipcRenderer.invoke('transfer:paths', id, paths),
  sendText: (id, value, kind) => ipcRenderer.invoke('transfer:text', id, value, kind),
  respondTransfer: (id, accept) => ipcRenderer.invoke('transfer:respond', id, accept),
  cancelTransfer: (id) => ipcRenderer.invoke('transfer:cancel', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  updateSettings: (changes) => ipcRenderer.invoke('settings:update', changes),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (value) => ipcRenderer.invoke('clipboard:write', value),
  reveal: (target) => ipcRenderer.invoke('shell:reveal', target),
  openLink: (value) => ipcRenderer.invoke('shell:open-link', value),
  onState: (callback) => listener('state', callback),
  onToast: (callback) => listener('toast', callback),
  onProgress: (callback) => listener('transfer-progress', callback),
  onIncomingRequest: (callback) => listener('incoming-request', callback),
  onReceivedMessage: (callback) => listener('received-message', callback),
});
