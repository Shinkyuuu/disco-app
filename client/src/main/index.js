import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAuthToken, parseAuthError, parseAuthUserId } from './protocolUrl.js';
import { store } from './store.js';
import { chatWindowHeightFor, HEADER_HEIGHT_BY_AVATAR_SIZE, MIN_CHAT_PANEL_HEIGHT } from './chatWindowSize.js';
import { chatMenuHeightFor, chatMenuPositionFor, MENU_POPUP_WIDTH } from './chatMenuPosition.js';
import { createWsClient } from './wsClient.js';
import { schemeFor } from './serverScheme.js';
import { fetchProfile, AuthError } from './profileClient.js';
import { isRetryableAuthFailure } from './authFailure.js';
import {
  reconcileFriendProfiles,
  seedDefaultProfileColors,
  resolveSpeakerProfile,
  getDefaultProfiles,
  getFriendProfiles,
  pickAvatarImage,
  clearAvatarImage,
  setDefaultProfileColors,
  addFriendProfile,
  setFriendProfileColors,
  removeFriendProfile,
} from './profiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTOCOL = 'disco';
// electron-builder applies build/icon.ico automatically for packaged builds -
// this is only needed so `npm run dev` also shows the real icon (taskbar +
// window), not the default Electron logo.
const ICON_PATH = path.join(app.getAppPath(), 'resources', 'icon.png');

// The header strip's height must grow with avatar size or larger icons get
// clipped by the window's own bounds (Electron windows clip all content to
// their rect, regardless of CSS overflow). Panel height stays constant across
// sizes so the message log doesn't shrink - only the window grows upward.
const CHAT_WINDOW_WIDTH = 480;

// Chromium's setMaximumSize(0, 0) means "no maximum" - but that sentinel
// only applies when BOTH dimensions are 0 (extensions::SizeConstraints::
// HasMaximumSize() is `width != 0 || height != 0`). Locking max height while
// collapsed (a real, deliberate constraint) made width's "0 = unbounded"
// stop applying, leaving a real maxWidth of 0 that conflicted with
// minWidth: 300 and silently blocked interactive width resize entirely.
// Using an explicit large value instead of 0 sidesteps the sentinel and its
// both-or-neither behavior - same value Electron's own constructor-option
// path (native_window.cc InitFromOptions) substitutes for an unset max.
const NO_MAX_WIDTH = 2147483647;

let updaterWindow = null;
let launcherWindow = null;
let chatWindow = null;
// The ⋯ menu's dropdown - a separate always-on-top popup rather than content
// inside chatWindow, so opening it never has to resize or move the chat
// window itself (see createChatMenuWindow below).
let chatMenuWindow = null;
let pendingAuthToken = null;
let pendingAuthError = null;
let deferredOpenUrl = null;

let wsClient = null;
const PROFILE_POLL_INTERVAL_MS = 5000;
let profilePollTimer = null;
let currentRoster = [];
const messageLog = []; // [{ speakerId, username, avatarURL, text }] - in order, capped at 1000 (see the 'transcript' handler below)

// Named generically, but every channel sent through here (roster/speaking/transcript/
// ws-connection-state) is only ever consumed by ChatView - LauncherView never subscribes
// to any of them - so this targets the chat window only, not every open window.
function broadcastToRenderers(channel, payload) {
  if (chatWindow) chatWindow.webContents.send(channel, payload);
}

const UNREACHABLE_THRESHOLD = 3;
let consecutiveFailures = 0;

// Last-known connection state, included in the pull snapshot so a chat window
// that opens (or re-opens) after a transient event still learns the truth -
// push events alone are lost if they fire before the renderer subscribes.
let lastConnectionState = { status: 'connected' };

function setConnectionState(state) {
  lastConnectionState = state;
  broadcastToRenderers('ws-connection-state', state);
}

function startWsClient() {
  if (wsClient) return;
  const token = store.get('sessionToken');
  const serverAddress = store.get('serverAddress');
  if (!token) {
    // A stale token gets deleted on auth-failure; surface that as the
    // session-expired screen instead of silently opening a dead window.
    setConnectionState({ status: 'auth-failed', reason: 'no session' });
    return;
  }

  wsClient = createWsClient({ serverAddress, token });

  wsClient.on('roster', (members) => {
    currentRoster = members;
    broadcastToRenderers('roster', members);
  });
  wsClient.on('speaking', (event) => broadcastToRenderers('speaking', event));
  wsClient.on('transcript', (event) => {
    // receivedAt drives the renderer's 5-second disappearing-chat timer -
    // stamped once here so live push and a later state-snapshot pull agree
    // on the same value (not a fresh Date.now() each time it's read).
    const finalized = { ...event, receivedAt: Date.now() };
    messageLog.push(finalized);
    // Bound the array a very long session's worth of finalized lines could otherwise grow
    // to unboundedly - this is what gets structured-clone'd over IPC on every chat-window
    // reopen (state-snapshot), so an unbounded array means an unbounded IPC payload.
    // 1000 lines is far more scrollback than this product's use case (a live
    // conversation, not an archive) ever needs to show on reopen.
    if (messageLog.length > 1000) messageLog.shift();
    broadcastToRenderers('transcript', finalized);
  });
  wsClient.on('open', () => {
    consecutiveFailures = 0;
    setConnectionState({ status: 'connected' });
  });
  wsClient.on('auth-failed', (reason) => {
    setConnectionState({ status: 'auth-failed', reason });
    wsClient.close();
    wsClient = null;
    if (!isRetryableAuthFailure(reason)) store.delete('sessionToken');
  });
  wsClient.on('close', (code, reason) => {
    consecutiveFailures += 1;
    const status = consecutiveFailures >= UNREACHABLE_THRESHOLD ? 'unreachable' : 'reconnecting';
    setConnectionState({ status, code, reason, serverAddress: store.get('serverAddress') });
  });
}

function handleProfileAuthFailure() {
  stopProfilePolling();
  store.delete('sessionToken');
  store.delete('loggedInUserId');
  if (launcherWindow) launcherWindow.webContents.send('auth-error', 'session_expired');
}

async function pollProfileOnce() {
  const token = store.get('sessionToken');
  if (!token) return { reachable: true, profile: null };
  try {
    const profile = await fetchProfile({ serverAddress: store.get('serverAddress'), token });
    return { reachable: true, profile };
  } catch (err) {
    if (err instanceof AuthError) {
      handleProfileAuthFailure();
      return null; // handleProfileAuthFailure already notified the renderer directly
    }
    return { reachable: false, profile: null };
  }
}

function startProfilePolling() {
  if (profilePollTimer) return;
  const tick = async () => {
    const result = await pollProfileOnce();
    if (result && launcherWindow) launcherWindow.webContents.send('profile', result);
  };
  tick(); // immediate poll so a fresh login / cold start doesn't wait a full interval
  profilePollTimer = setInterval(tick, PROFILE_POLL_INTERVAL_MS);
}

function stopProfilePolling() {
  if (profilePollTimer) {
    clearInterval(profilePollTimer);
    profilePollTimer = null;
  }
}

// Resizes an already-open chat window to match the current avatarSize/
// chatCollapsed settings. While collapsed, min/max height are both locked to
// the thin-bar height so the window can't be drag-resized taller than the
// CSS thin bar; while expanded, the normal min height is restored and the
// max height is uncapped. Width comes from the window's own current size,
// not the persisted chatWindowWidth - this can run right after the user
// finishes a drag-resize, and the 'resized' listener's store write is not
// guaranteed to have landed yet at that point.
function applyChatWindowSize(win) {
  const avatarSize = store.get('avatarSize');
  const collapsed = store.get('chatCollapsed');
  const height = chatWindowHeightFor(avatarSize, { collapsed, panelHeight: store.get('chatWindowPanelHeight') });
  const [currentWidth] = win.getSize();
  if (collapsed) {
    win.setMinimumSize(300, height);
    win.setMaximumSize(NO_MAX_WIDTH, height);
  } else {
    win.setMinimumSize(300, HEADER_HEIGHT_BY_AVATAR_SIZE.large + MIN_CHAT_PANEL_HEIGHT);
    win.setMaximumSize(0, 0);
  }
  win.setSize(currentWidth, height);
}

function createChatWindow() {
  if (chatWindow) {
    chatWindow.focus();
    return;
  }
  const avatarSize = store.get('avatarSize');
  const collapsed = store.get('chatCollapsed');
  const locked = store.get('chatLocked');
  const height = chatWindowHeightFor(avatarSize, { collapsed, panelHeight: store.get('chatWindowPanelHeight') });
  chatWindow = new BrowserWindow({
    width: store.get('chatWindowWidth'),
    height,
    minWidth: 300,
    ...(collapsed
      ? { minHeight: height, maxHeight: height }
      : { minHeight: HEADER_HEIGHT_BY_AVATAR_SIZE.large + MIN_CHAT_PANEL_HEIGHT }),
    frame: false,
    icon: ICON_PATH,
    // Transparent so the header strip above the chat panel is invisible -
    // speaker avatars render there and appear to float above the window.
    transparent: true,
    resizable: !locked,
    movable: !locked,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // 'screen-saver' is the highest always-on-top level Electron exposes; the
  // default 'floating' level can still lose the z-order fight against
  // fullscreen games. Reasserting on blur covers games that re-grab the top
  // of the z-order themselves when they regain focus after a click on the
  // overlay - but skip it while the ⋯ menu popup is open: that popup taking
  // focus is what triggers this blur in the first place, and reasserting
  // chatWindow's own always-on-top here would re-raise it back above the
  // popup, leaving the popup rendered behind chatWindow and unable to
  // receive the clicks/hovers meant for it.
  chatWindow.setAlwaysOnTop(true, 'screen-saver');
  chatWindow.on('blur', () => {
    if (chatMenuWindow) return;
    if (chatWindow.isAlwaysOnTop()) chatWindow.setAlwaysOnTop(true, 'screen-saver');
  });
  chatWindow.on('resized', () => {
    const [w, h] = chatWindow.getSize();
    store.set('chatWindowWidth', w);
    // While collapsed the window is locked to the thin-bar height, which
    // isn't a real panel-height preference - skip persisting it so the
    // user's actual panel height survives a collapse/expand round trip.
    if (store.get('chatCollapsed')) return;
    const currentAvatarSize = store.get('avatarSize');
    const currentHeaderH = HEADER_HEIGHT_BY_AVATAR_SIZE[currentAvatarSize] ?? HEADER_HEIGHT_BY_AVATAR_SIZE.small;
    store.set('chatWindowPanelHeight', Math.max(h - currentHeaderH, MIN_CHAT_PANEL_HEIGHT));
  });
  chatWindow.loadURL(rendererUrl('chat'));
  chatWindow.on('closed', () => {
    chatWindow = null;
    chatMenuWindow?.close();
    if (launcherWindow) launcherWindow.show();
  });
  if (launcherWindow) launcherWindow.hide();
}

// The ⋯ menu's dropdown, as its own small always-on-top popup rather than
// content clipped inside chatWindow - Electron clips all rendered content to
// a window's own rect, so a dropdown that needs more room than the (possibly
// collapsed, thin-bar-sized) chat window currently has would otherwise force
// resizing/moving the chat window itself just to show it. A second click on
// ⋯ while the popup is open toggles it closed, matching a normal dropdown.
// `anchor` is the ⋯ button's own screen rect (renderer-measured, since the
// main process only knows the chat window's rect, not where the button sits
// within it) and `sections` mirrors which optional props WindowMenu received,
// so the popup shows the same items the inline dropdown used to.
function createChatMenuWindow(anchor, sections) {
  if (chatMenuWindow) {
    chatMenuWindow.close();
    return;
  }
  const size = { width: MENU_POPUP_WIDTH, height: chatMenuHeightFor(sections) };
  const workArea = screen.getDisplayMatching(anchor).workArea;
  const { x, y, opensBelow } = chatMenuPositionFor(anchor, size, workArea);

  chatMenuWindow = new BrowserWindow({
    x,
    y,
    width: size.width,
    height: size.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    // Shown immediately (not the usual show:false + 'ready-to-show' dance) -
    // x/y/width/height are already fully known up front here, unlike windows
    // that size themselves to measured content, so there's no flash of
    // wrong-sized content to hide. Windows applies its own fade to a
    // transparent window's *visibility transitions*, so showing it as part
    // of creation rather than as a separate later show() call avoids that
    // transition entirely, instead of merely hiding it behind a delay.
    show: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  chatMenuWindow.setAlwaysOnTop(true, 'screen-saver');
  chatMenuWindow.loadURL(rendererUrl('chat-menu') + '&' + menuSectionsQuery(sections) + `&openDirection=${opensBelow ? 'down' : 'up'}`);
  // Losing focus means the user clicked elsewhere (the chat window, another
  // app, the desktop) - same dismissal a normal dropdown gets from a
  // click-outside handler, just expressed at the window level since this
  // menu no longer shares a window with anything else to attach one to.
  chatMenuWindow.on('blur', () => chatMenuWindow?.close());
  chatMenuWindow.on('closed', () => {
    chatMenuWindow = null;
    // Restore the reassert-on-blur behavior skipped above while this popup
    // was open, in case something else (e.g. a game regaining focus) needs
    // to be pushed back below the chat window now that the popup is gone.
    if (chatWindow?.isAlwaysOnTop()) chatWindow.setAlwaysOnTop(true, 'screen-saver');
  });
}

function menuSectionsQuery(sections) {
  return Object.entries(sections)
    .filter(([, enabled]) => enabled)
    .map(([key]) => `${key}=1`)
    .join('&');
}

function logout() {
  stopProfilePolling();
  wsClient?.close();
  wsClient = null;
  messageLog.length = 0;
  currentRoster = [];
  store.delete('sessionToken');
  store.delete('loggedInUserId');
  if (chatWindow) chatWindow.close();
  setConnectionState({ status: 'logged-out' });
}

app.on('before-quit', () => {
  wsClient?.close();
});

// --- Protocol registration ---
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

function deliverAuthToken(token, userId) {
  store.set('sessionToken', token);
  if (userId) store.set('loggedInUserId', userId);
  startProfilePolling();
  if (launcherWindow) {
    launcherWindow.webContents.send('auth-token', token);
  } else {
    pendingAuthToken = token;
  }
}

function deliverAuthError(reason) {
  if (launcherWindow) {
    launcherWindow.webContents.send('auth-error', reason);
  } else {
    pendingAuthError = reason;
  }
}

function handleDeepLink(url) {
  const token = parseAuthToken(url);
  if (token) {
    deliverAuthToken(token, parseAuthUserId(url));
    return;
  }
  const error = parseAuthError(url);
  if (error) deliverAuthError(error);
}

// macOS: open-url can fire before app.whenReady() - register at top level, buffer until ready.
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (app.isReady()) {
    handleDeepLink(url);
  } else {
    deferredOpenUrl = url;
  }
});

// Windows/Linux: the protocol redirect launches a second process; forward it to the first.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    if (launcherWindow) {
      if (launcherWindow.isMinimized()) launcherWindow.restore();
      launcherWindow.focus();
    }
    const url = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (url) handleDeepLink(url);
  });

  app.whenReady().then(() => {
    reconcileFriendProfiles(store);
    seedDefaultProfileColors(store);
    registerIpcHandlers();
    createUpdaterWindow();
    setupAutoUpdater();
  });
}

function registerIpcHandlers() {
  ipcMain.handle('open-login', (_event, serverAddress) => {
    const scheme = schemeFor(serverAddress, { secure: 'https', insecure: 'http' });
    shell.openExternal(`${scheme}://${serverAddress}/auth/login`);
  });

  ipcMain.handle('get-settings', () => ({
    serverAddress: store.get('serverAddress'),
    avatarMode: store.get('avatarMode'),
    avatarSize: store.get('avatarSize'),
    chatSize: store.get('chatSize'),
    chatOpacity: store.get('chatOpacity'),
    chatCollapsed: store.get('chatCollapsed'),
    chatLocked: store.get('chatLocked'),
    chatFontFamily: store.get('chatFontFamily'),
    chatBorderStyle: store.get('chatBorderStyle'),
    hasSessionToken: Boolean(store.get('sessionToken')),
    loggedInUserId: store.get('loggedInUserId'),
    appVersion: app.getVersion(),
  }));

  ipcMain.handle('set-settings', (_event, partial) => {
    for (const [key, value] of Object.entries(partial)) {
      store.set(key, value);
    }
    // Resize the already-open chat window immediately - otherwise a larger
    // avatar size, or a collapse/expand toggle, wouldn't take visual effect
    // (or would clip) until the next time the window happens to be recreated.
    if (('avatarSize' in partial || 'chatCollapsed' in partial) && chatWindow) {
      applyChatWindowSize(chatWindow);
    }
    // Same live-apply reasoning as above: movable/resizable are BrowserWindow
    // properties, not CSS, so an open window needs them flipped directly.
    if ('chatLocked' in partial && chatWindow) {
      chatWindow.setMovable(!partial.chatLocked);
      chatWindow.setResizable(!partial.chatLocked);
    }
    // getSettings is only read once, on mount, by every renderer - push every
    // change through so an already-open chat window (and its ⋯ menu popup,
    // if open) update live instead of waiting for their next reopen. Needed
    // both for the launcher's Settings page (font/border - a separate
    // renderer process from the chat window) and for the ⋯ menu popup, which
    // is also a separate renderer process from the chat window it changes
    // avatarSize/chatSize/chatOpacity/chatCollapsed/chatLocked for.
    if (chatWindow) chatWindow.webContents.send('settings-changed', partial);
    if (chatMenuWindow) chatMenuWindow.webContents.send('settings-changed', partial);
  });

  ipcMain.handle('start-chat-window', () => {
    startWsClient();
    createChatWindow();
  });

  // Pulled by the chat window once its listeners are mounted - a pushed
  // snapshot can fire before the renderer subscribes and be lost.
  ipcMain.handle('get-state-snapshot', () => ({
    roster: currentRoster,
    messageLog,
    connectionState: lastConnectionState,
  }));

  ipcMain.handle('get-profile', () => pollProfileOnce());

  ipcMain.handle('logout', () => logout());

  ipcMain.handle('focus-launcher-settings', () => {
    if (launcherWindow) {
      if (launcherWindow.isMinimized()) launcherWindow.restore();
      launcherWindow.focus();
      launcherWindow.webContents.send('open-settings');
    }
  });

  // Generic window-chrome controls for the custom (frame: false) title bar -
  // targets whichever window's renderer invoked them, not a hardcoded window,
  // so the same preload API works for any frameless window.
  ipcMain.handle('window-minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle('window-toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.handle('window-close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle('window-is-maximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  ipcMain.handle('resolve-speaker-profile', (_event, args) => resolveSpeakerProfile(store, args));
  ipcMain.handle('get-default-profiles', () => getDefaultProfiles(store));
  ipcMain.handle('get-friend-profiles', () => getFriendProfiles(store));
  ipcMain.handle('pick-default-avatar-image', (_event, { slotIndex, kind }) =>
    pickAvatarImage({ scope: 'default', id: String(slotIndex + 1).padStart(2, '0'), kind }),
  );
  ipcMain.handle('pick-friend-avatar-image', async (_event, { userId, kind }) => {
    const dataUrl = await pickAvatarImage({ scope: 'friend', id: userId, kind });
    // A picked image alone should make this user "have a profile" so
    // getFriendProfiles lists them (and the preview persists) even before any
    // color is set - mirrors reconciliation for hand-created folders.
    if (dataUrl) addFriendProfile(store, userId);
    return dataUrl;
  });
  ipcMain.handle('clear-default-avatar-image', (_event, { slotIndex, kind }) =>
    clearAvatarImage({ scope: 'default', id: String(slotIndex + 1).padStart(2, '0'), kind }),
  );
  ipcMain.handle('clear-friend-avatar-image', (_event, { userId, kind }) =>
    clearAvatarImage({ scope: 'friend', id: userId, kind }),
  );
  ipcMain.handle('set-default-profile-colors', (_event, { slotIndex, colors }) =>
    setDefaultProfileColors(store, slotIndex, colors),
  );
  ipcMain.handle('add-friend-profile', (_event, userId) => addFriendProfile(store, userId));
  ipcMain.handle('set-friend-profile-colors', (_event, { userId, colors }) =>
    setFriendProfileColors(store, userId, colors),
  );
  ipcMain.handle('remove-friend-profile', (_event, userId) => removeFriendProfile(store, userId));

  ipcMain.handle('resize-window', (event, { width, height }) => {
    BrowserWindow.fromWebContents(event.sender)?.setSize(width, height);
  });

  // Unlike the generic window-chrome controls above, pin state is only ever
  // about the chat window's own always-on-top-ness - always targets
  // chatWindow explicitly (rather than the invoking renderer) since the ⋯
  // menu popup calls this too, to show/toggle the chat window's pin state
  // from its own, separate renderer process.
  ipcMain.handle('window-is-always-on-top', () => chatWindow?.isAlwaysOnTop() ?? false);

  ipcMain.handle('window-set-always-on-top', (_event, value) => {
    chatWindow?.setAlwaysOnTop(value, 'screen-saver');
  });

  ipcMain.handle('close-chat-window', () => chatWindow?.close());

  ipcMain.handle('open-chat-menu', (_event, { anchor, sections }) => createChatMenuWindow(anchor, sections));
}

function rendererUrl(view) {
  const base = process.env.ELECTRON_RENDERER_URL || `file://${path.join(__dirname, '../renderer/index.html')}`;
  return `${base}?view=${view}`;
}

function createLauncherWindow() {
  launcherWindow = new BrowserWindow({
    width: 850,
    height: 900,
    minWidth: 440,
    minHeight: 560,
    frame: false, // no OS title/menu bar - the renderer draws its own header + menu
    show: false,
    backgroundColor: '#0d0e11',
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  launcherWindow.loadURL(rendererUrl('launcher'));
  launcherWindow.on('ready-to-show', () => {
    launcherWindow.show();
    if (pendingAuthToken) {
      launcherWindow.webContents.send('auth-token', pendingAuthToken);
      pendingAuthToken = null;
    }
    if (pendingAuthError) {
      launcherWindow.webContents.send('auth-error', pendingAuthError);
      pendingAuthError = null;
    }
  });
  launcherWindow.on('maximize', () => launcherWindow.webContents.send('window-maximized-change', true));
  launcherWindow.on('unmaximize', () => launcherWindow.webContents.send('window-maximized-change', false));
  launcherWindow.on('closed', () => {
    launcherWindow = null;
    stopProfilePolling();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let updaterOpenedAt = 0;
const MIN_UPDATER_MS = 1000;
let didTransitionToLauncher = false;

function createUpdaterWindow() {
  updaterOpenedAt = Date.now();
  updaterWindow = new BrowserWindow({
    width: 360,
    height: 200,
    resizable: false,
    frame: false,
    show: false,
    backgroundColor: '#0d0e11',
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  updaterWindow.loadURL(rendererUrl('updater'));
  updaterWindow.once('ready-to-show', () => updaterWindow?.show());
  updaterWindow.on('closed', () => {
    updaterWindow = null;
  });
}

function transitionToLauncher() {
  if (didTransitionToLauncher) return;
  didTransitionToLauncher = true;
  const elapsed = Date.now() - updaterOpenedAt;
  const remaining = Math.max(0, MIN_UPDATER_MS - elapsed);
  setTimeout(() => {
    createLauncherWindow();
    if (store.get('sessionToken')) startProfilePolling();
    if (deferredOpenUrl) handleDeepLink(deferredOpenUrl);
    updaterWindow?.close();
  }, remaining);
}

function setupAutoUpdater() {
  autoUpdater.on('update-not-available', () => {
    transitionToLauncher();
  });
  autoUpdater.on('update-available', (info) => {
    updaterWindow?.webContents.send('updater-status', { phase: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('download-progress', (progress) => {
    updaterWindow?.webContents.send('updater-status', { phase: 'downloading', percent: Math.floor(progress.percent) });
  });
  autoUpdater.on('update-downloaded', () => {
    // Silent install; relaunch after install completes.
    autoUpdater.quitAndInstall(true, true);
  });
  autoUpdater.on('error', () => {
    transitionToLauncher();
  });

  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(() => transitionToLauncher());
  } else {
    // In dev, skip the update check and open the launcher after the minimum delay.
    setTimeout(transitionToLauncher, MIN_UPDATER_MS);
  }
}

export { deliverAuthToken, createLauncherWindow };
