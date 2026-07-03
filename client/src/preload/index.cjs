const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onAuthToken: (callback) => {
    ipcRenderer.on('auth-token', (_event, token) => callback(token));
  },
  onAuthError: (callback) => {
    ipcRenderer.on('auth-error', (_event, reason) => callback(reason));
  },
  openLogin: (serverAddress) => ipcRenderer.invoke('open-login', serverAddress),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (partial) => ipcRenderer.invoke('set-settings', partial),
  startChatWindow: () => ipcRenderer.invoke('start-chat-window'),
  logout: () => ipcRenderer.invoke('logout'),
  onStateSnapshot: (callback) => ipcRenderer.on('state-snapshot', (_e, snapshot) => callback(snapshot)),
  onRoster: (callback) => ipcRenderer.on('roster', (_e, members) => callback(members)),
  onSpeaking: (callback) => ipcRenderer.on('speaking', (_e, event) => callback(event)),
  onTranscript: (callback) => ipcRenderer.on('transcript', (_e, event) => callback(event)),
});
