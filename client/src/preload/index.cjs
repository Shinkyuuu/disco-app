const { contextBridge, ipcRenderer } = require('electron');

// Every on* subscription returns an unsubscribe function. Without it, a React
// effect re-run (StrictMode's dev double-mount, or any real remount) stacks a
// second listener and non-idempotent handlers - like appending a transcript
// line - fire once per stacked listener.
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
  onSettingsChanged: subscribe('settings-changed', (callback) => (_e, partial) => callback(partial)),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window-toggle-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  isWindowMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onWindowMaximizedChange: subscribe('window-maximized-change', (callback) => (_e, isMaximized) => callback(isMaximized)),
  resolveSpeakerProfile: (args) => ipcRenderer.invoke('resolve-speaker-profile', args),
  getDefaultProfiles: () => ipcRenderer.invoke('get-default-profiles'),
  getFriendProfiles: () => ipcRenderer.invoke('get-friend-profiles'),
  pickDefaultAvatarImage: (slotIndex, kind) => ipcRenderer.invoke('pick-default-avatar-image', { slotIndex, kind }),
  pickFriendAvatarImage: (userId, kind) => ipcRenderer.invoke('pick-friend-avatar-image', { userId, kind }),
  clearDefaultAvatarImage: (slotIndex, kind) => ipcRenderer.invoke('clear-default-avatar-image', { slotIndex, kind }),
  clearFriendAvatarImage: (userId, kind) => ipcRenderer.invoke('clear-friend-avatar-image', { userId, kind }),
  setDefaultProfileColors: (slotIndex, colors) => ipcRenderer.invoke('set-default-profile-colors', { slotIndex, colors }),
  addFriendProfile: (userId) => ipcRenderer.invoke('add-friend-profile', userId),
  setFriendProfileColors: (userId, colors) => ipcRenderer.invoke('set-friend-profile-colors', { userId, colors }),
  removeFriendProfile: (userId) => ipcRenderer.invoke('remove-friend-profile', userId),
  resizeWindow: (width, height) => ipcRenderer.invoke('resize-window', { width, height }),
  isAlwaysOnTop: () => ipcRenderer.invoke('window-is-always-on-top'),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('window-set-always-on-top', value),
  closeChatWindow: () => ipcRenderer.invoke('close-chat-window'),
  openChatMenu: (anchor, sections) => ipcRenderer.invoke('open-chat-menu', { anchor, sections }),
  getProfile: () => ipcRenderer.invoke('get-profile'),
  onProfile: subscribe('profile', (callback) => (_e, result) => callback(result)),
  onUpdaterStatus: subscribe('updater-status', (callback) => (_e, status) => callback(status)),
});
