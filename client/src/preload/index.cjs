/*
 * Copyright 2026 Cody Park
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
  setIgnoreMouseEvents: (ignore) => ipcRenderer.invoke('set-ignore-mouse-events', ignore),
  closeChatWindow: () => ipcRenderer.invoke('close-chat-window'),
  openChatMenu: (anchor, sections) => ipcRenderer.invoke('open-chat-menu', { anchor, sections }),
  getProfile: () => ipcRenderer.invoke('get-profile'),
  onProfile: subscribe('profile', (callback) => (_e, result) => callback(result)),
  onUpdaterStatus: subscribe('updater-status', (callback) => (_e, status) => callback(status)),
});
