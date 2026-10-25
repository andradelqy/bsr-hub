const { contextBridge, ipcRenderer } = require('electron');

// Only the capabilities used by the current launcher are exposed.
contextBridge.exposeInMainWorld('electronAPI', {
  controlWindow: action => {
    if (['minimize', 'maximize', 'close'].includes(action)) {
      ipcRenderer.send('window-control', action);
    }
  },
  sendNotification: (title, body) => ipcRenderer.send('notify', title, body),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  onThemeUpdate: callback => {
    const listener = (_event, theme) => callback(theme);
    ipcRenderer.on('theme-updated', listener);
    return () => ipcRenderer.removeListener('theme-updated', listener);
  },
  startSteamLogin: state => ipcRenderer.invoke('start-steam-login', state),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  content: Object.freeze({
    initialize: () => ipcRenderer.invoke('content:initialize'),
    status: packages => ipcRenderer.invoke('content:status', packages),
    chooseGame: () => ipcRenderer.invoke('content:choose-game'),
    inspectPackage: () => ipcRenderer.invoke('content:inspect-package'),
    download: (pkg, sessionToken) => ipcRenderer.invoke('content:download', { objectId:pkg?.objectId }, sessionToken),
    cancelDownload: slug => ipcRenderer.invoke('content:cancel-download', slug),
    cancelInstall: slug => ipcRenderer.invoke('content:cancel-install', slug),
    install: (pkg, sessionToken) => ipcRenderer.invoke('content:install', { objectId:pkg?.objectId }, sessionToken),
    uninstall: slug => ipcRenderer.invoke('content:uninstall', slug),
    verify: slug => ipcRenderer.invoke('content:verify', slug),
    audit: packages => ipcRenderer.invoke('content:audit', packages),
    repair: (pkg, sessionToken) => ipcRenderer.invoke('content:repair', { objectId:pkg?.objectId }, sessionToken),
    clearDownload: slug => ipcRenderer.invoke('content:clear-download', slug),
    joinServer: config => ipcRenderer.invoke('content:join', config),
    onProgress: callback => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on('content:progress', listener);
      return () => ipcRenderer.removeListener('content:progress', listener);
    }
  })
});
