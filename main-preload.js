const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mainAPI', {
    onUnresponsive: (callback) => ipcRenderer.on('window-unresponsive', callback),
    onResponsive: (callback) => ipcRenderer.on('window-responsive', callback)
});
