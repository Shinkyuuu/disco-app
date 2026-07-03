import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAuthToken, parseAuthError } from './protocolUrl.js';
import { store } from './store.js';
import { createWsClient } from './wsClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTOCOL = 'discord-echo';

let launcherWindow = null;
let chatWindow = null;
let pendingAuthToken = null;
let pendingAuthError = null;
let deferredOpenUrl = null;

let wsClient = null;
let currentRoster = [];
const messageLog = []; // [{ speakerId, username, avatarURL, text, isFinal }] — finalized entries only, in order, capped at 1000 (see the 'transcript' handler below)

// Named generically, but every channel sent through here (roster/speaking/transcript/
// ws-connection-state) is only ever consumed by ChatView — LauncherView never subscribes
// to any of them — so this targets the chat window only, not every open window.
function broadcastToRenderers(channel, payload) {
  if (chatWindow) chatWindow.webContents.send(channel, payload);
}

const UNREACHABLE_THRESHOLD = 3;
let consecutiveFailures = 0;

function startWsClient() {
  const token = store.get('sessionToken');
  const serverAddress = store.get('serverAddress');
  if (!token || wsClient) return;

  wsClient = createWsClient({ serverAddress, token });

  wsClient.on('roster', (members) => {
    currentRoster = members;
    broadcastToRenderers('roster', members);
  });
  wsClient.on('speaking', (event) => broadcastToRenderers('speaking', event));
  wsClient.on('transcript', (event) => {
    if (event.isFinal) {
      messageLog.push(event);
      // Bound the array a very long session's worth of finalized lines could otherwise grow
      // to unboundedly — this is what gets structured-clone'd over IPC on every chat-window
      // reopen (state-snapshot), so an unbounded array means an unbounded IPC payload.
      // 1000 lines is far more scrollback than this product's use case (a live
      // conversation, not an archive) ever needs to show on reopen.
      if (messageLog.length > 1000) messageLog.shift();
    }
    broadcastToRenderers('transcript', event);
  });
  wsClient.on('open', () => {
    consecutiveFailures = 0;
    broadcastToRenderers('ws-connection-state', { status: 'connected' });
  });
  wsClient.on('auth-failed', (reason) => {
    broadcastToRenderers('ws-connection-state', { status: 'auth-failed', reason });
    wsClient.close();
    wsClient = null;
    store.delete('sessionToken');
  });
  wsClient.on('close', (code, reason) => {
    consecutiveFailures += 1;
    const status = consecutiveFailures >= UNREACHABLE_THRESHOLD ? 'unreachable' : 'reconnecting';
    broadcastToRenderers('ws-connection-state', { status, code, reason, serverAddress: store.get('serverAddress') });
  });
}

function createChatWindow() {
  if (chatWindow) {
    chatWindow.focus();
    return;
  }
  chatWindow = new BrowserWindow({
    width: 480,
    height: 360,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  chatWindow.loadURL(rendererUrl('chat'));
  chatWindow.on('ready-to-show', () => {
    chatWindow.webContents.send('state-snapshot', { roster: currentRoster, messageLog });
  });
  chatWindow.on('closed', () => {
    chatWindow = null;
    if (launcherWindow) launcherWindow.restore();
  });
  if (launcherWindow) launcherWindow.minimize();
}

function logout() {
  wsClient?.close();
  wsClient = null;
  messageLog.length = 0;
  currentRoster = [];
  store.delete('sessionToken');
  if (chatWindow) chatWindow.close();
  broadcastToRenderers('ws-connection-state', { status: 'logged-out' });
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

function deliverAuthToken(token) {
  store.set('sessionToken', token);
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
    deliverAuthToken(token);
    return;
  }
  const error = parseAuthError(url);
  if (error) deliverAuthError(error);
}

// macOS: open-url can fire before app.whenReady() — register at top level, buffer until ready.
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
    registerIpcHandlers();
    createLauncherWindow();
    if (deferredOpenUrl) handleDeepLink(deferredOpenUrl);
  });
}

function registerIpcHandlers() {
  ipcMain.handle('open-login', (_event, serverAddress) => {
    // Same scheme rule as wsClient.js: bare host:port is local dev (http),
    // a plain hostname is a hosted deployment behind TLS (https).
    const scheme = serverAddress.includes('localhost') || /:\d+$/.test(serverAddress) ? 'http' : 'https';
    shell.openExternal(`${scheme}://${serverAddress}/auth/login`);
  });

  ipcMain.handle('get-settings', () => ({
    serverAddress: store.get('serverAddress'),
    avatarMode: store.get('avatarMode'),
    hasSessionToken: Boolean(store.get('sessionToken')),
  }));

  ipcMain.handle('set-settings', (_event, partial) => {
    for (const [key, value] of Object.entries(partial)) {
      store.set(key, value);
    }
  });

  ipcMain.handle('start-chat-window', () => {
    startWsClient();
    createChatWindow();
  });

  ipcMain.handle('logout', () => logout());

  ipcMain.handle('focus-launcher-settings', () => {
    if (launcherWindow) {
      if (launcherWindow.isMinimized()) launcherWindow.restore();
      launcherWindow.focus();
      launcherWindow.webContents.send('open-settings');
    }
  });
}

function rendererUrl(view) {
  const base = process.env.ELECTRON_RENDERER_URL || `file://${path.join(__dirname, '../renderer/index.html')}`;
  return `${base}?view=${view}`;
}

function createLauncherWindow() {
  launcherWindow = new BrowserWindow({
    width: 360,
    height: 480,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  launcherWindow.loadURL(rendererUrl('launcher'));
  launcherWindow.on('ready-to-show', () => {
    if (pendingAuthToken) {
      launcherWindow.webContents.send('auth-token', pendingAuthToken);
      pendingAuthToken = null;
    }
    if (pendingAuthError) {
      launcherWindow.webContents.send('auth-error', pendingAuthError);
      pendingAuthError = null;
    }
  });
  launcherWindow.on('closed', () => {
    launcherWindow = null;
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

export { deliverAuthToken, createLauncherWindow };
