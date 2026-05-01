const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcherAPI', {
    launch: (settings) => ipcRenderer.send('launch-app', settings)
});
