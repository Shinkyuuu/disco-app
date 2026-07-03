import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAuthToken, parseAuthError } from './protocolUrl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTOCOL = 'discord-echo';

let launcherWindow = null;
let chatWindow = null;
let pendingAuthToken = null;
let pendingAuthError = null;
let deferredOpenUrl = null;

// --- Protocol registration ---
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

function deliverAuthToken(token) {
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
    createLauncherWindow();
    if (deferredOpenUrl) handleDeepLink(deferredOpenUrl);
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
      preload: path.join(__dirname, '../preload/index.js'),
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
