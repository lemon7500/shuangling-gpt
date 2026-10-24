'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('shuanglingPanel', Object.freeze({
  snapshot: options => ipcRenderer.invoke('shuangling-panel:snapshot', { includeUsage: options?.includeUsage === true }),
  command: value => ipcRenderer.invoke('shuangling-panel:command', value),
  close: () => ipcRenderer.send('shuangling-panel:close'),
}));
