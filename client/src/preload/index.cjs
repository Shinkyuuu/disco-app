const { contextBridge, ipcRenderer } = require('electron');

// Every on* subscription returns an unsubscribe function. Without it, a React
// effect re-run (StrictMode's dev double-mount, or any real remount) stacks a
// second listener and non-idempotent handlers — like appending a transcript
// line — fire once per stacked listener.
function subscribe(channel, wrap) {
  return (callback) => {
    const listener = wrap(callback);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('api', {
  onAuthToken: subscribe('auth-token', (callback) => (_event, token) => callback(token)),
  onAuthError: subscribe('auth-error', (callback) => (_event, reason) => callback(reason)),
  openLogin: (serverAddress) => ipcRenderer.invoke('open-login', serverAddress),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (partial) => ipcRenderer.invoke('set-settings', partial),
  startChatWindow: () => ipcRenderer.invoke('start-chat-window'),
  logout: () => ipcRenderer.invoke('logout'),
  getStateSnapshot: () => ipcRenderer.invoke('get-state-snapshot'),
  onRoster: subscribe('roster', (callback) => (_e, members) => callback(members)),
  onSpeaking: subscribe('speaking', (callback) => (_e, event) => callback(event)),
  onTranscript: subscribe('transcript', (callback) => (_e, event) => callback(event)),
  focusLauncherSettings: () => ipcRenderer.invoke('focus-launcher-settings'),
  onOpenSettings: subscribe('open-settings', (callback) => () => callback()),
  onConnectionState: subscribe('ws-connection-state', (callback) => (_e, state) => callback(state)),
});
