'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('feather', {
  platform: process.platform,
  bootstrap: () => invoke('feather:bootstrap'),
  start: () => invoke('feather:start'),
  decide: (payload) => invoke('feather:decide', payload),
  listReports: () => invoke('feather:reports'),
  openReportsFolder: () => invoke('feather:openReportsFolder'),
  openReport: (filePath) => invoke('feather:openReport', filePath),
  onEvent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, payload) => {
      if (payload && typeof payload.type === 'string') callback(payload);
    };
    ipcRenderer.on('feather:event', handler);
    return () => ipcRenderer.removeListener('feather:event', handler);
  },
  window: {
    minimize: () => invoke('window:minimize'),
    toggleMaximize: () => invoke('window:toggleMaximize'),
    close: () => invoke('window:close')
  }
});
