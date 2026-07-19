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

import 'dotenv/config';
import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseAuthCode, parseAuthError } from './protocolUrl.js';
import { exchangeAuthCode } from './authClient.js';
import { store } from './store.js';
import {
  chatWindowHeightFor,
  chatWindowWidthFor,
  headerHeightFor,
  HEADER_HEIGHT_BY_AVATAR_SIZE,
  MIN_CHAT_PANEL_HEIGHT,
} from './chatWindowSize.js';
import { chatMenuHeightFor, chatMenuPositionFor, MENU_POPUP_WIDTH } from './chatMenuPosition.js';
import { nearestEdge, snappedPosition } from './chatWindowSnap.js';
import { createWsClient } from './wsClient.js';
import { sanitizeSettingsPatch } from './settingsKeys.js';
import { schemeFor } from './serverScheme.js';
import { fetchProfile, AuthError } from './profileClient.js';
import { isRetryableAuthFailure } from './authFailure.js';
import {
  reconcileFriendProfiles,
  migrateLegacySpeakingAvatars,
  seedDefaultProfileColors,
  resolveSpeakerProfile,
  getDefaultProfiles,
  getFriendProfiles,
  pickAvatarImage,
  clearAvatarImage,
  saveFramesAvatar,
  pickFrameSourceImages,
  setDefaultProfileSpeakingType,
  setFriendProfileSpeakingType,
  clearDefaultProfileSpeakingTypeIfActive,
  clearFriendProfileSpeakingTypeIfActive,
  setDefaultProfileColors,
  addFriendProfile,
  setFriendProfileColors,
  removeFriendProfile,
  slotDirName,
  pickImageFileForBroadcast,
  MIME_BY_EXT,
  MAX_ENCODED_GIF_BYTES,
} from './profiles.js';
import {
  requestAvatarUploadUrl,
  confirmAvatarUpload,
  clearBroadcastAvatar as clearBroadcastAvatarRemote,
  uploadFileToPresignedUrl,
  getBroadcastAvatarUrls,
  setPublicColors,
  setActiveSpeakingAvatarType,
} from './avatarClient.js';
import { encodeFramesToGif, GifEncodingError } from './gifEncoder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTOCOL = 'disco';
// electron-builder applies build/icon.ico automatically for packaged builds -
// this is only needed so `npm run dev` also shows the real icon (taskbar +
// window), not the default Electron logo.
const ICON_PATH = path.join(app.getAppPath(), 'resources', 'icon.png');

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
// Same reasoning as NO_MAX_WIDTH above, mirrored for the auto-width setting:
// locking max width (a real, deliberate constraint) breaks the maxHeight
// "0 = unbounded" sentinel, so height needs its own explicit large value too
// when width is locked but height should stay freely resizable.
const NO_MAX_HEIGHT = 2147483647;
// Set via a SERVER_ADDRESS entry in client/.env - not user-editable in Settings.
const SERVER_ADDRESS = process.env.SERVER_ADDRESS || 'disco.schemainit.com';

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
let pendingOpenAttempt = null; // the in-flight connection's first-outcome promise, or null once settled
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
  if (wsClient) {
    return pendingOpenAttempt ?? Promise.resolve(
      lastConnectionState.status === 'connected' ? { ok: true } : { ok: false, state: lastConnectionState },
    );
  }

  const token = store.get('sessionToken');
  if (!token) {
    // A stale token gets deleted on auth-failure; surface that as the
    // session-expired screen instead of silently opening a dead window.
    const state = { status: 'auth-failed', reason: 'no session' };
    setConnectionState(state);
    return Promise.resolve({ ok: false, state });
  }

  const client = createWsClient({ serverAddress: SERVER_ADDRESS, token });
  wsClient = client;

  let settled = false;
  const attempt = new Promise((resolve) => {
    // Resolves once, on the connection's first outcome - success, a
    // terminal failure, or escalation to unreachable. Before settling, a
    // terminal failure means "the open attempt failed" (resolved with
    // ok:false, for start-chat-window to turn into a launcher banner
    // instead of ever creating the window). After settling, the exact same
    // events instead mean "a live session just broke" (shown inline via
    // ChatStatusBanner - see scheduleChatWindowClose). The persistent
    // handlers below keep running for the connection's whole lifetime
    // regardless of what this promise does.
    const settle = (result) => {
      if (settled) return;
      settled = true;
      pendingOpenAttempt = null;
      resolve(result);
    };

    client.on('roster', (members) => {
      currentRoster = members;
      broadcastToRenderers('roster', members);
      // Auto-width fits the window to exactly the current roster's avatars -
      // a join/leave changes that fit, so re-apply immediately rather than
      // waiting for the next settings change or window reopen.
      if (store.get('chatAutoWidth') && chatWindow) applyChatWindowSize(chatWindow);
      // Every roster message - not just the first - means this connection is
      // live and authenticated, so it always clears a reconnecting/unreachable
      // banner left over from an earlier drop. Without this, a reconnect after
      // the initial connect would keep resuming speaking/transcript normally
      // while the banner stayed stuck forever, since nothing else ever moves
      // the state back to 'connected'.
      setConnectionState({ status: 'connected' });
      // The first roster message is the server's actual "you're authenticated
      // and in the tracked channel" signal - the raw socket's 'open' event
      // (below) fires the instant the TCP connection completes and the auth
      // message is merely sent, well before the server has validated it.
      // Settling on 'open' instead of this would resolve the promise ok:true
      // moments before an invalid attempt's real 4001/4002/4003 close arrives,
      // which would have already opened the chat window on a connection that
      // was never actually authorized.
      if (!settled) settle({ ok: true });
    });
    client.on('speaking', (event) => broadcastToRenderers('speaking', event));
    client.on('transcript', (event) => {
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

    client.on('open', () => {
      // Only resets the reconnect-attempt counter here - the socket having
      // opened confirms the network path is reachable, but not that the
      // server has authenticated this attempt yet. See the 'roster' handler
      // above for why the actual "connected" signal waits for that instead.
      consecutiveFailures = 0;
    });

    client.on('auth-failed', (reason, code) => {
      const state = { status: 'auth-failed', reason, code };
      setConnectionState(state);
      client.close();
      wsClient = null;
      if (!isRetryableAuthFailure(code)) store.delete('sessionToken');
      if (!settled) settle({ ok: false, state });
      else scheduleChatWindowClose();
    });

    client.on('session-ended', () => {
      const state = { status: 'session-ended' };
      setConnectionState(state);
      client.close();
      wsClient = null;
      // Structurally this can only fire after the first 'roster' message
      // already settled the promise (it's itself a message over an
      // authenticated connection, and roster always arrives first) - the
      // !settled branch is kept for uniformity with auth-failed rather than
      // relying on that invariant silently.
      if (!settled) settle({ ok: false, state });
      else scheduleChatWindowClose();
    });

    client.on('close', (code, reason) => {
      // wsClient.js emits 'close' unconditionally, even for a caller-initiated
      // close (the auth-failed/session-ended handlers above) - only the
      // reconnect timer is suppressed by closedByCaller there, not this event.
      // Without this guard, that late close event would silently overwrite the
      // terminal state those handlers just set with a spurious reconnecting/
      // unreachable status. Comparing identity (not just wsClient's truthiness)
      // also correctly ignores a stale event from this now-dead client after
      // wsClient has since been reassigned to a newer instance.
      if (wsClient !== client) return;
      consecutiveFailures += 1;
      const status = consecutiveFailures >= UNREACHABLE_THRESHOLD ? 'unreachable' : 'reconnecting';
      const state = { status, code, reason, serverAddress: SERVER_ADDRESS };
      setConnectionState(state);
      // unreachable blocks an in-flight open attempt, but once settled (the
      // window is already open), both reconnecting and unreachable just
      // update the inline chat screen - no dialog, no window action.
      if (status === 'unreachable' && !settled) settle({ ok: false, state });
    });
  });

  pendingOpenAttempt = attempt;
  return attempt;
}

// A terminal failure on an already-open, already-working chat window (the
// bot left, or a reconnect attempt discovers the session is gone) is shown
// inline via ChatStatusBanner - same as reconnecting/unreachable, visible
// regardless of the window's collapsed state, no native dialog interruption.
// Since there's nothing left to do in that window (no live captions, no
// action button), it closes itself once the message has had time to be read.
const TERMINAL_CLOSE_DELAY_MS = 8000;

function scheduleChatWindowClose() {
  // Snapshot the specific window instance rather than closing over the
  // mutable chatWindow binding - a manual close-then-reopen within the delay
  // window would otherwise leave this timer pointed at whatever chatWindow
  // happens to be 8 seconds from now (a different, healthy window), closing
  // it out from under the user instead of the one this was scheduled for.
  const target = chatWindow;
  setTimeout(() => {
    if (chatWindow === target) chatWindow?.close();
  }, TERMINAL_CLOSE_DELAY_MS);
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
    const profile = await fetchProfile({ serverAddress: SERVER_ADDRESS, token });
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
  // Guards against a slow/hung response (fetchProfile's own timeout is a
  // ceiling, not a guarantee it's always faster than the poll interval) piling
  // up overlapping requests every 5s, whose replies could then also resolve
  // out of order and let a stale one overwrite a newer reachability result.
  let pollInFlight = false;
  const tick = async () => {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      const result = await pollProfileOnce();
      if (result && launcherWindow) launcherWindow.webContents.send('profile', result);
    } finally {
      pollInFlight = false;
    }
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
// chatCollapsed/chatAutoWidth/chatLocked settings. While collapsed, min/max
// height are both locked to the thin-bar height so the window can't be
// drag-resized taller than the CSS thin bar; while expanded, the normal min
// height is restored and the max height is uncapped. Width works the same
// way, mirrored onto the width axis: while auto-width is on, min/max width
// are both locked to the roster-fitting width computed by chatWindowWidthFor
// so the user can't drag-resize away from it. While auto-width is off, width
// comes from the window's own current size, not the persisted
// chatWindowWidth - this can run right after the user finishes a drag-resize,
// and the 'resized' listener's store write is not guaranteed to have landed
// yet at that point.
//
// chatLocked freezes min=max=current size instead of calling
// win.setResizable(false) - Electron 39 has a known Windows regression where
// toggling setResizable() at runtime on a transparent, frameless window
// desyncs the native resize-border cursor from the resize capability Chromium
// actually enforces (still works, but shows the wrong/stale cursor). Pinning
// min/max size achieves the same "can't drag-resize" effect without ever
// calling setResizable() after construction.
function applyChatWindowSize(win) {
  const avatarSize = store.get('avatarSize');
  const avatarMode = store.get('avatarMode');
  const collapsed = store.get('chatCollapsed');
  const autoWidth = store.get('chatAutoWidth');
  const locked = store.get('chatLocked');
  const height = chatWindowHeightFor(avatarSize, { collapsed, avatarMode, panelHeight: store.get('chatWindowPanelHeight') });
  const [currentWidth] = win.getSize();
  const width = autoWidth ? chatWindowWidthFor(currentRoster.length, avatarSize, avatarMode) : currentWidth;

  if (locked) {
    win.setMinimumSize(width, height);
    win.setMaximumSize(width, height);
    win.setSize(width, height);
    reflowSnappedEdge(win);
    return;
  }

  const minHeight = collapsed ? height : HEADER_HEIGHT_BY_AVATAR_SIZE.large + MIN_CHAT_PANEL_HEIGHT;
  win.setMinimumSize(autoWidth ? width : 300, minHeight);

  if (collapsed && autoWidth) {
    win.setMaximumSize(width, height);
  } else if (collapsed) {
    win.setMaximumSize(NO_MAX_WIDTH, height);
  } else if (autoWidth) {
    win.setMaximumSize(width, NO_MAX_HEIGHT);
  } else {
    win.setMaximumSize(0, 0);
  }
  win.setSize(width, height);
  reflowSnappedEdge(win);
}

// The persisted chatWindowPosition, if it's still on a currently-connected
// display - ignored otherwise so a position saved on a monitor that's since
// been unplugged doesn't strand the window off-screen with no way to drag it
// back (this app is a streaming overlay, so multi-monitor setups changing
// are a real, not hypothetical, case).
function chatWindowPositionOnScreen() {
  const position = store.get('chatWindowPosition');
  if (!position) return null;
  const onScreen = screen
    .getAllDisplays()
    .some(({ bounds }) =>
      position.x >= bounds.x &&
      position.y >= bounds.y &&
      position.x < bounds.x + bounds.width &&
      position.y < bounds.y + bounds.height
    );
  return onScreen ? position : null;
}

// Central point through which the chat window is repositioned for "snap to
// edge" - see chatWindowSnap.js for the pure edge/position math. Two
// distinct entry points on purpose: snapWindowToNearestEdge actively
// re-chooses which edge is closest (a drag settling, the setting being
// turned on, or the window being created), while reflowSnappedEdge only
// keeps the window flush against whichever edge is already recorded (any
// programmatic size change) - it never re-chooses, so a collapse/expand or
// auto-width change can't silently flip which edge the window is snapped to.
function displayForWindow(win) {
  const { x, y, width, height } = win.getBounds();
  return screen.getDisplayNearestPoint({ x: x + width / 2, y: y + height / 2 });
}

// `target` is 'bounds' or 'workArea' - which of the display's two
// rectangles to stay flush against (see chatWindowSnap.js's nearestEdge for
// why there are two).
function moveToEdge(win, edge, target) {
  const bounds = win.getBounds();
  const display = displayForWindow(win);
  const rect = target === 'workArea' ? display.workArea : display.bounds;
  const { x, y } = snappedPosition(bounds, rect, edge);
  if (x !== bounds.x || y !== bounds.y) win.setPosition(x, y);
}

function snapWindowToNearestEdge(win) {
  if (!store.get('chatSnapToEdge')) return;
  const bounds = win.getBounds();
  const display = displayForWindow(win);
  const { edge, target } = nearestEdge(bounds, display.bounds, display.workArea);
  store.set('chatSnappedEdge', { edge, target });
  moveToEdge(win, edge, target);
}

function reflowSnappedEdge(win) {
  if (!store.get('chatSnapToEdge')) return;
  const snapped = store.get('chatSnappedEdge');
  if (!snapped) return;
  moveToEdge(win, snapped.edge, snapped.target);
}

function createChatWindow() {
  if (chatWindow) {
    chatWindow.focus();
    return;
  }
  const avatarSize = store.get('avatarSize');
  const avatarMode = store.get('avatarMode');
  const collapsed = store.get('chatCollapsed');
  const autoWidth = store.get('chatAutoWidth');
  const locked = store.get('chatLocked');
  const height = chatWindowHeightFor(avatarSize, { collapsed, avatarMode, panelHeight: store.get('chatWindowPanelHeight') });
  const width = autoWidth ? chatWindowWidthFor(currentRoster.length, avatarSize, avatarMode) : store.get('chatWindowWidth');
  const savedPosition = chatWindowPositionOnScreen();
  chatWindow = new BrowserWindow({
    width,
    height,
    ...(savedPosition ? { x: savedPosition.x, y: savedPosition.y } : {}),
    // While locked, min/max are both pinned to the current size instead of
    // passing resizable: false - see applyChatWindowSize's comment for why
    // (a runtime setResizable() toggle is what triggers the Electron 39
    // Windows cursor bug, not the size constraints).
    ...(locked
      ? { minWidth: width, maxWidth: width, minHeight: height, maxHeight: height }
      : {
          ...(autoWidth ? { minWidth: width, maxWidth: width } : { minWidth: 300 }),
          ...(collapsed
            ? { minHeight: height, maxHeight: height }
            : { minHeight: HEADER_HEIGHT_BY_AVATAR_SIZE.large + MIN_CHAT_PANEL_HEIGHT }),
        }),
    frame: false,
    icon: ICON_PATH,
    // Transparent so the header strip above the chat panel is invisible -
    // speaker avatars render there and appear to float above the window.
    transparent: true,
    resizable: true,
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
  // While locked, the window is click-through so it doesn't block whatever's
  // behind it - forward:true keeps mouse-move events flowing to the renderer
  // so the ⋯ menu button (the only way back to "Unlock window") can still
  // detect hover and un-ignore itself. See WindowMenu.jsx.
  if (locked) chatWindow.setIgnoreMouseEvents(true, { forward: true });
  chatWindow.on('blur', () => {
    if (chatMenuWindow) return;
    if (chatWindow.isAlwaysOnTop()) chatWindow.setAlwaysOnTop(true, 'screen-saver');
  });
  chatWindow.on('moved', () => {
    snapWindowToNearestEdge(chatWindow);
    const [x, y] = chatWindow.getPosition();
    store.set('chatWindowPosition', { x, y });
  });
  chatWindow.on('resized', () => {
    const [w, h] = chatWindow.getSize();
    // While auto-width is on, width is locked and driven by the roster, not
    // a user preference - skip persisting it so the user's last manual width
    // survives an auto-width on/off round trip, same reasoning as the
    // collapsed-height skip below.
    if (!store.get('chatAutoWidth')) store.set('chatWindowWidth', w);
    // While collapsed the window is locked to the thin-bar height, which
    // isn't a real panel-height preference - skip persisting it so the
    // user's actual panel height survives a collapse/expand round trip.
    if (store.get('chatCollapsed')) return;
    const currentHeaderH = headerHeightFor(store.get('avatarSize'), store.get('avatarMode'));
    store.set('chatWindowPanelHeight', Math.max(h - currentHeaderH, MIN_CHAT_PANEL_HEIGHT));
  });
  if (store.get('chatSnapToEdge')) snapWindowToNearestEdge(chatWindow);
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
    // Same show:false + 'ready-to-show' pattern as launcherWindow/updaterWindow
    // above - showing immediately (before Chromium's first paint) let Windows
    // present the OS window surface as opaque white first, which then flashed
    // to transparent and finally to the real dropdown content once
    // ChatMenuView's async settings fetch resolved - visible as an open/close/
    // reopen flicker with a white flash in between.
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  chatMenuWindow.setAlwaysOnTop(true, 'screen-saver');
  chatMenuWindow.once('ready-to-show', () => chatMenuWindow?.show());
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

async function handleDeepLink(url) {
  const code = parseAuthCode(url);
  if (code) {
    try {
      const { token, userId } = await exchangeAuthCode({ serverAddress: SERVER_ADDRESS, code });
      deliverAuthToken(token, userId);
    } catch (err) {
      console.error('Auth code exchange failed:', err);
      deliverAuthError('exchange_failed');
    }
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
    migrateLegacySpeakingAvatars(store);
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
    serverAddress: SERVER_ADDRESS,
    avatarMode: store.get('avatarMode'),
    avatarSize: store.get('avatarSize'),
    chatSize: store.get('chatSize'),
    chatOpacity: store.get('chatOpacity'),
    chatCollapsed: store.get('chatCollapsed'),
    chatLocked: store.get('chatLocked'),
    chatAutoWidth: store.get('chatAutoWidth'),
    chatSnapToEdge: store.get('chatSnapToEdge'),
    chatFontFamily: store.get('chatFontFamily'),
    chatBorderStyle: store.get('chatBorderStyle'),
    betaUpdates: store.get('betaUpdates'),
    hasSessionToken: Boolean(store.get('sessionToken')),
    loggedInUserId: store.get('loggedInUserId'),
    appVersion: app.getVersion(),
  }));

  ipcMain.handle('set-settings', (_event, partial) => {
    // Renderer processes are only ever trusted to change the settings
    // get-settings itself exposes - not sessionToken, defaultProfiles, or
    // other store keys those windows have no legitimate reason to touch.
    const sanitized = sanitizeSettingsPatch(partial);
    for (const [key, value] of Object.entries(sanitized)) {
      store.set(key, value);
    }
    // Resize the already-open chat window immediately - otherwise a larger
    // avatar size, or a collapse/expand toggle, wouldn't take visual effect
    // (or would clip) until the next time the window happens to be recreated.
    if (('avatarSize' in sanitized || 'avatarMode' in sanitized || 'chatCollapsed' in sanitized || 'chatAutoWidth' in sanitized || 'chatLocked' in sanitized) && chatWindow) {
      applyChatWindowSize(chatWindow);
    }
    // Same live-apply reasoning as above: movable is a BrowserWindow property,
    // not CSS, so an open window needs it flipped directly. (Resizing is
    // frozen via applyChatWindowSize's min=max pinning above, not
    // setResizable() - see its comment for why.)
    if ('chatLocked' in sanitized && chatWindow) {
      chatWindow.setMovable(!sanitized.chatLocked);
      chatWindow.setIgnoreMouseEvents(sanitized.chatLocked, { forward: true });
    }
    // Turning "snap to edge" on repositions the window right away, per the
    // design - it doesn't wait for the next drag to take effect.
    if ('chatSnapToEdge' in sanitized && sanitized.chatSnapToEdge && chatWindow) {
      snapWindowToNearestEdge(chatWindow);
    }
    // getSettings is only read once, on mount, by every renderer - push every
    // change through so an already-open chat window (and its ⋯ menu popup,
    // if open) update live instead of waiting for their next reopen. Needed
    // both for the launcher's Settings page (font/border - a separate
    // renderer process from the chat window) and for the ⋯ menu popup, which
    // is also a separate renderer process from the chat window it changes
    // avatarSize/chatSize/chatOpacity/chatCollapsed/chatLocked for.
    if (chatWindow) chatWindow.webContents.send('settings-changed', sanitized);
    if (chatMenuWindow) chatMenuWindow.webContents.send('settings-changed', sanitized);
  });

  ipcMain.handle('start-chat-window', async () => {
    const result = await startWsClient();
    if (result.ok) {
      createChatWindow();
      return { opened: true };
    }
    return { opened: false, state: result.state };
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
  ipcMain.handle('pick-default-avatar-image', async (_event, { slotIndex, kind }) => {
    const dataUrl = await pickAvatarImage({ scope: 'default', id: slotDirName(slotIndex), kind });
    if (dataUrl && kind.startsWith('speaking-')) setDefaultProfileSpeakingType(store, slotIndex, kind.slice('speaking-'.length));
    return dataUrl;
  });
  ipcMain.handle('pick-friend-avatar-image', async (_event, { userId, kind }) => {
    const dataUrl = await pickAvatarImage({ scope: 'friend', id: userId, kind });
    // A picked image alone should make this user "have a profile" so
    // getFriendProfiles lists them (and the preview persists) even before any
    // color is set - mirrors reconciliation for hand-created folders.
    if (dataUrl) addFriendProfile(store, userId);
    if (dataUrl && kind.startsWith('speaking-')) setFriendProfileSpeakingType(store, userId, kind.slice('speaking-'.length));
    return dataUrl;
  });
  ipcMain.handle('clear-default-avatar-image', (_event, { slotIndex, kind }) => {
    clearAvatarImage({ scope: 'default', id: slotDirName(slotIndex), kind });
    if (kind.startsWith('speaking-')) clearDefaultProfileSpeakingTypeIfActive(store, slotIndex, kind.slice('speaking-'.length));
  });
  ipcMain.handle('clear-friend-avatar-image', (_event, { userId, kind }) => {
    clearAvatarImage({ scope: 'friend', id: userId, kind });
    if (kind.startsWith('speaking-')) clearFriendProfileSpeakingTypeIfActive(store, userId, kind.slice('speaking-'.length));
  });

  ipcMain.handle('pick-frame-source-images', () => pickFrameSourceImages());

  ipcMain.handle('save-default-frames-avatar', (_event, { slotIndex, frameFilePaths, fps }) =>
    saveFramesAvatar({ store, scope: 'default', id: slotDirName(slotIndex), frameFilePaths, fps }),
  );
  ipcMain.handle('save-friend-frames-avatar', async (_event, { userId, frameFilePaths, fps }) => {
    const dataUrl = await saveFramesAvatar({ store, scope: 'friend', id: userId, frameFilePaths, fps });
    addFriendProfile(store, userId);
    return dataUrl;
  });

  ipcMain.handle('set-default-avatar-type', (_event, { slotIndex, type }) => setDefaultProfileSpeakingType(store, slotIndex, type));
  ipcMain.handle('set-friend-avatar-type', (_event, { userId, type }) => setFriendProfileSpeakingType(store, userId, type));
  ipcMain.handle('set-default-profile-colors', (_event, { slotIndex, colors }) =>
    setDefaultProfileColors(store, slotIndex, colors),
  );
  ipcMain.handle('add-friend-profile', (_event, userId) => addFriendProfile(store, userId));
  ipcMain.handle('set-friend-profile-colors', (_event, { userId, colors }) =>
    setFriendProfileColors(store, userId, colors),
  );
  ipcMain.handle('remove-friend-profile', (_event, userId) => removeFriendProfile(store, userId));

  ipcMain.handle('upload-broadcast-avatar', async (_event, kind) => {
    const picked = await pickImageFileForBroadcast(kind);
    if (!picked) return null;
    const { filePath, ext } = picked;
    const token = store.get('sessionToken');
    if (!token) throw new Error('Not logged in');

    const { uploadUrl, version } = await requestAvatarUploadUrl({ serverAddress: SERVER_ADDRESS, token, state: kind, ext });
    const fileBuffer = fs.readFileSync(filePath);
    const contentType = MIME_BY_EXT[`.${ext}`] ?? 'application/octet-stream';
    await uploadFileToPresignedUrl({ uploadUrl, fileBuffer, contentType });
    const { avatarUrl } = await confirmAvatarUpload({ serverAddress: SERVER_ADDRESS, token, state: kind, version, ext });
    return avatarUrl;
  });

  ipcMain.handle('upload-broadcast-frames-avatar', async (_event, { frameFilePaths, fps }) => {
    const token = store.get('sessionToken');
    if (!token) throw new Error('Not logged in');

    const gifBytes = await encodeFramesToGif(frameFilePaths, fps);
    if (gifBytes.length > MAX_ENCODED_GIF_BYTES) {
      throw new GifEncodingError(`Encoded GIF is ${gifBytes.length} bytes, exceeding the ${MAX_ENCODED_GIF_BYTES}-byte avatar upload limit`);
    }

    const { uploadUrl, version } = await requestAvatarUploadUrl({ serverAddress: SERVER_ADDRESS, token, state: 'speaking-frames', ext: 'gif' });
    await uploadFileToPresignedUrl({ uploadUrl, fileBuffer: gifBytes, contentType: 'image/gif' });
    const { avatarUrl } = await confirmAvatarUpload({
      serverAddress: SERVER_ADDRESS,
      token,
      state: 'speaking-frames',
      version,
      ext: 'gif',
      fps,
      frameCount: frameFilePaths.length,
    });
    return avatarUrl;
  });

  ipcMain.handle('set-broadcast-speaking-type', async (_event, type) => {
    const token = store.get('sessionToken');
    if (!token) throw new Error('Not logged in');
    return setActiveSpeakingAvatarType({ serverAddress: SERVER_ADDRESS, token, type });
  });

  ipcMain.handle('clear-broadcast-avatar', async (_event, kind) => {
    const token = store.get('sessionToken');
    if (!token) throw new Error('Not logged in');
    await clearBroadcastAvatarRemote({ serverAddress: SERVER_ADDRESS, token, state: kind });
  });

  ipcMain.handle('set-public-colors', async (_event, { usernameColor, chatColor }) => {
    const token = store.get('sessionToken');
    if (!token) throw new Error('Not logged in');
    return setPublicColors({ serverAddress: SERVER_ADDRESS, token, usernameColor, chatColor });
  });

  ipcMain.handle('get-broadcast-avatar', async () => {
    const token = store.get('sessionToken');
    if (!token) return { silentURL: null, speakingURL: null };
    return getBroadcastAvatarUrls({ serverAddress: SERVER_ADDRESS, token });
  });

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

  // Called by the ⋯ menu button while the chat window is locked (and thus
  // click-through) so hovering the button carves out a clickable exception -
  // otherwise there'd be no way to reach "Unlock window" again. See
  // WindowMenu.jsx.
  ipcMain.handle('set-ignore-mouse-events', (_event, ignore) => {
    chatWindow?.setIgnoreMouseEvents(ignore, { forward: true });
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
let updateVersion = null;
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
  const betaUpdates = store.get('betaUpdates');
  autoUpdater.allowPrerelease = betaUpdates;
  // Must be a non-null override: electron-updater resolves the channel as
  // `updater.channel || options.channel`, so `null` falls through to whatever
  // channel was baked into this install's app-update.yml at build time (e.g.
  // 'beta' for builds from the beta pipeline), instead of forcing 'latest'.
  autoUpdater.channel = betaUpdates ? 'beta' : 'latest';

  autoUpdater.on('update-not-available', () => {
    transitionToLauncher();
  });
  autoUpdater.on('update-available', (info) => {
    updateVersion = info.version;
    updaterWindow?.webContents.send('updater-status', { phase: 'downloading', version: updateVersion, percent: 0 });
  });
  autoUpdater.on('download-progress', (progress) => {
    updaterWindow?.webContents.send('updater-status', { phase: 'downloading', version: updateVersion, percent: Math.floor(progress.percent) });
  });
  autoUpdater.on('update-downloaded', () => {
    // Not silent: shows the one-click NSIS installer's native progress window
    // during install so the app doesn't appear to hang; relaunch after install completes.
    autoUpdater.quitAndInstall(false, true);
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
