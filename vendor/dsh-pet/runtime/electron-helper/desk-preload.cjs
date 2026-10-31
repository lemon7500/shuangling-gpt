'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const tabs = ['focus', 'journal', 'notes'];
contextBridge.exposeInMainWorld('shuanglingDesk', Object.freeze({
  snapshot: () => ipcRenderer.invoke('shuangling-desk:snapshot'),
  command: value => ipcRenderer.invoke('shuangling-desk:command', value),
  close: () => ipcRenderer.send('shuangling-desk:close'),
  onCloseRequest(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('shuangling-desk:request-close', listener);
    return () => ipcRenderer.removeListener('shuangling-desk:request-close', listener);
  },
  onTab(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, tab) => { if (tabs.includes(tab)) callback(tab); };
    ipcRenderer.on('shuangling-desk:tab', listener);
    return () => ipcRenderer.removeListener('shuangling-desk:tab', listener);
  },
}));
