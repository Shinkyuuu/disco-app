# Per-User Avatar & Color Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the build-time-bundled 10-avatar system with a runtime-configurable profile system (per-slot + per-friend + self avatars/colors), configured from a new consolidated Settings page.

**Architecture:** Avatar image bytes live as real files under `client/resources/avatars/` (read fresh to data URLs, never stored in electron-store). Colors + profile existence live in electron-store. A new main-process module `profiles.js` owns all store/file I/O and resolution precedence (friend → default slot → universal fallback). A pure `resolveAppearance.js` in the renderer maps a resolved profile + speaking/mode state to concrete `avatarSrc`/colors. The client learns its own Discord user_id via one extra query param on the existing auth deep-link.

**Tech Stack:** Electron 39 (ESM main, CJS sandboxed preload), React 19, electron-store 11, electron-vite, `node:test`.

## Global Constraints

- **Scope:** `client/` only, plus one one-line change to root `auth.js`. Dev-mode only - no packaging/writability concerns.
- **Theme values (reuse, do not invent):** panels `#26272d`; buttons/inputs `#3a3b42` (hover `#46474f`); window/root bg `#1e1f24`; destructive red `#e81123`; text `#e4e6ea`.
- **`speakerId` === Discord `user_id`** everywhere (roster, transcripts, friend keys, self). Verified in `bot.js` (`speakerId: member.id`).
- **Avatar image bytes are NEVER persisted in electron-store** - always read fresh from disk to data URLs.
- **Resource path resolution:** `path.join(app.getAppPath(), 'resources', 'avatars')`. In electron-vite dev `app.getAppPath()` returns the `client/` project root.
- **Avatar file matching is by basename glob** `silent.*` / `speaking.*`, extensions `.png/.jpg/.jpeg/.webp/.gif`. Before writing a newly-picked file, delete any existing `silent.*`/`speaking.*` of a *different* extension for that same kind.
- **Non-goals:** no live-update of an open chat window on profile change; no user_id validation; no friend nicknames; no orphaned-self cleanup UI.
- Follow existing patterns: single-purpose main modules wired up by `index.js`; pure logic colocated with a `node:test` file (`backoff.js`/`protocolUrl.js`); thin `ipcRenderer.invoke` preload wrappers.
- **Do not touch** the uncommitted 1-line `MESSAGE_VISIBLE_MS` tweak in `MessageLog.jsx` (unrelated).

---

### Task 1: Backend - emit `userId` on the auth success redirect

**Files:**
- Modify: `auth.js:94`

**Interfaces:**
- Produces: success redirect deep link now `discord-echo://auth?token=<t>&userId=<id>`.

- [ ] **Step 1: Add the `userId` query param to the success redirect**

In `auth.js`, `handleAuthCallback`, replace the success `res.writeHead`:

```js
    const { access_token } = await exchangeCodeForToken(code);
    const userId = await fetchDiscordUserId(access_token);
    const sessionToken = createSessionToken(userId);
    res.writeHead(302, {
      Location: `discord-echo://auth?token=${sessionToken}&userId=${encodeURIComponent(userId)}`,
    });
    res.end();
```

- [ ] **Step 2: Verify existing auth tests still pass**

Run: `node --test auth.test.js`
Expected: PASS (no assertions on the redirect string; `createSessionToken`/`verifySessionToken` unaffected).

- [ ] **Step 3: Commit**

```bash
git add auth.js
git commit -m "feat(auth): include userId in the auth success deep link"
```

---

### Task 2: `parseAuthUserId` (pure, TDD)

**Files:**
- Modify: `client/src/main/protocolUrl.js`
- Test: `client/src/main/protocolUrl.test.js`

**Interfaces:**
- Produces: `parseAuthUserId(deepLinkUrl) -> string | null`.

- [ ] **Step 1: Write the failing tests** - append to `client/src/main/protocolUrl.test.js`:

```js
import { parseAuthToken, parseAuthError, parseAuthUserId } from './protocolUrl.js';

test('parseAuthUserId extracts the userId from a success redirect', () => {
  assert.equal(parseAuthUserId('discord-echo://auth?token=abc&userId=123456789'), '123456789');
});

test('parseAuthUserId returns null when there is no userId param', () => {
  assert.equal(parseAuthUserId('discord-echo://auth?token=abc'), null);
});

test('parseAuthUserId returns null for a non-discord-echo URL', () => {
  assert.equal(parseAuthUserId('https://example.com?userId=123'), null);
});
```

(Update the existing top `import` line of the test file to include `parseAuthUserId`.)

- [ ] **Step 2: Run to verify it fails**

Run: `node --test client/src/main/protocolUrl.test.js`
Expected: FAIL - `parseAuthUserId is not a function`.

- [ ] **Step 3: Implement** - append to `client/src/main/protocolUrl.js`:

```js
export function parseAuthUserId(deepLinkUrl) {
  return parseDeepLink(deepLinkUrl)?.searchParams.get('userId') ?? null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test client/src/main/protocolUrl.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add client/src/main/protocolUrl.js client/src/main/protocolUrl.test.js
git commit -m "feat(client): parseAuthUserId for the auth deep link"
```

---

### Task 3: Store defaults for profiles + loggedInUserId

**Files:**
- Modify: `client/src/main/store.js`

**Interfaces:**
- Produces store keys: `loggedInUserId: null`, `defaultProfiles: Array(10) of {usernameColor:null, chatColor:null}`, `friendProfiles: {}`.

- [ ] **Step 1: Add the new defaults** - replace the `defaults` object in `client/src/main/store.js`:

```js
import Store from 'electron-store';

export const store = new Store({
  defaults: {
    serverAddress: 'localhost:3000',
    avatarMode: 'discord',
    avatarSize: 'small',
    sessionToken: null,
    loggedInUserId: null,
    defaultProfiles: Array.from({ length: 10 }, () => ({ usernameColor: null, chatColor: null })),
    friendProfiles: {},
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add client/src/main/store.js
git commit -m "feat(client): store defaults for profiles and loggedInUserId"
```

---

### Task 4: Wire `loggedInUserId` through auth delivery + logout

**Files:**
- Modify: `client/src/main/index.js` (imports, `deliverAuthToken`, `handleDeepLink`, `logout`)

**Interfaces:**
- Consumes: `parseAuthUserId` (Task 2), store key `loggedInUserId` (Task 3).
- Produces: `deliverAuthToken(token, userId)` stores both; `logout()` clears both.

- [ ] **Step 1: Import `parseAuthUserId`** - update line 4:

```js
import { parseAuthToken, parseAuthError, parseAuthUserId } from './protocolUrl.js';
```

- [ ] **Step 2: Extend `deliverAuthToken`** (currently lines 155-162):

```js
function deliverAuthToken(token, userId) {
  store.set('sessionToken', token);
  if (userId) store.set('loggedInUserId', userId);
  if (launcherWindow) {
    launcherWindow.webContents.send('auth-token', token);
  } else {
    pendingAuthToken = token;
  }
}
```

- [ ] **Step 3: Extract both params in `handleDeepLink`** (currently lines 172-180):

```js
function handleDeepLink(url) {
  const token = parseAuthToken(url);
  if (token) {
    deliverAuthToken(token, parseAuthUserId(url));
    return;
  }
  const error = parseAuthError(url);
  if (error) deliverAuthError(error);
}
```

- [ ] **Step 4: Clear `loggedInUserId` in `logout`** - add to the body (after `store.delete('sessionToken')`, line 137):

```js
  store.delete('sessionToken');
  store.delete('loggedInUserId');
```

- [ ] **Step 5: Sanity check** - `node --test client/src/main/protocolUrl.test.js` still PASS; app is not run here (manual later).

- [ ] **Step 6: Commit**

```bash
git add client/src/main/index.js
git commit -m "feat(client): persist loggedInUserId on auth, clear on logout"
```

---

### Task 5: Migrate avatar images to `resources/avatars/defaults/`

**Files:**
- Create: `client/resources/avatars/defaults/01/silent.png` … `10/silent.png` (migrated bytes)
- Create: `client/resources/avatars/friends/.gitkeep`

**Interfaces:**
- Produces: on-disk default silent avatars at the paths `profiles.js` (Task 7) reads.

- [ ] **Step 1: Copy each PNG into its slot folder** (uses current working-copy bytes, incl. the swapped avatar-01):

```bash
cd client
for n in 01 02 03 04 05 06 07 08 09 10; do
  mkdir -p "resources/avatars/defaults/$n"
  cp "src/renderer/src/assets/avatars/avatar-$n.png" "resources/avatars/defaults/$n/silent.png"
done
mkdir -p resources/avatars/friends
touch resources/avatars/friends/.gitkeep
```

- [ ] **Step 2: Verify** all 10 exist

Run: `ls client/resources/avatars/defaults/*/silent.png | wc -l`
Expected: `10`

- [ ] **Step 3: Commit** (old assets dir is removed later in Task 13, after code stops importing it)

```bash
git add client/resources/avatars
git commit -m "chore(client): migrate default avatars to resources/avatars/defaults"
```

---

### Task 6: `resolveAppearance` pure function (TDD)

**Files:**
- Create: `client/src/renderer/src/resolveAppearance.js`
- Test: `client/src/renderer/src/resolveAppearance.test.js`

**Interfaces:**
- Produces: `resolveAppearance({ avatarMode, isSpeaking, discordAvatarURL, profile }) -> { avatarSrc, usernameColor, chatColor }`. `profile` shape: `{ avatarSilent, avatarSpeaking, usernameColor, chatColor }` (any field may be null).

- [ ] **Step 1: Write failing tests** - `client/src/renderer/src/resolveAppearance.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAppearance } from './resolveAppearance.js';

const discord = 'https://cdn/discord.png';
const full = { avatarSilent: 'data:silent', avatarSpeaking: 'data:speaking', usernameColor: '#f00', chatColor: '#0f0' };

test('discord mode always uses the discord avatar', () => {
  const r = resolveAppearance({ avatarMode: 'discord', isSpeaking: true, discordAvatarURL: discord, profile: full });
  assert.equal(r.avatarSrc, discord);
});

test('discord mode still applies color overrides', () => {
  const r = resolveAppearance({ avatarMode: 'discord', isSpeaking: false, discordAvatarURL: discord, profile: full });
  assert.equal(r.usernameColor, '#f00');
  assert.equal(r.chatColor, '#0f0');
});

test('custom mode uses speaking image when speaking', () => {
  const r = resolveAppearance({ avatarMode: 'custom', isSpeaking: true, discordAvatarURL: discord, profile: full });
  assert.equal(r.avatarSrc, 'data:speaking');
});

test('custom mode uses silent image when not speaking', () => {
  const r = resolveAppearance({ avatarMode: 'custom', isSpeaking: false, discordAvatarURL: discord, profile: full });
  assert.equal(r.avatarSrc, 'data:silent');
});

test('custom mode falls back to silent when speaking image missing', () => {
  const profile = { ...full, avatarSpeaking: null };
  const r = resolveAppearance({ avatarMode: 'custom', isSpeaking: true, discordAvatarURL: discord, profile });
  assert.equal(r.avatarSrc, 'data:silent');
});

test('custom mode falls back to discord avatar when no custom images', () => {
  const profile = { avatarSilent: null, avatarSpeaking: null, usernameColor: null, chatColor: null };
  const r = resolveAppearance({ avatarMode: 'custom', isSpeaking: true, discordAvatarURL: discord, profile });
  assert.equal(r.avatarSrc, discord);
});

test('null colors pass through as null', () => {
  const profile = { avatarSilent: null, avatarSpeaking: null, usernameColor: null, chatColor: null };
  const r = resolveAppearance({ avatarMode: 'custom', isSpeaking: false, discordAvatarURL: discord, profile });
  assert.equal(r.usernameColor, null);
  assert.equal(r.chatColor, null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test client/src/renderer/src/resolveAppearance.test.js`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement** - `client/src/renderer/src/resolveAppearance.js`:

```js
// Pure mapping from a resolved profile + current mode/speaking state to concrete
// render values. No Electron dependency - unit-tested like backoff.js/protocolUrl.js.
export function resolveAppearance({ avatarMode, isSpeaking, discordAvatarURL, profile }) {
  const avatarSrc =
    avatarMode === 'discord'
      ? discordAvatarURL
      : (isSpeaking ? profile.avatarSpeaking ?? profile.avatarSilent : profile.avatarSilent) ?? discordAvatarURL;
  return {
    avatarSrc,
    usernameColor: profile.usernameColor ?? null,
    chatColor: profile.chatColor ?? null,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test client/src/renderer/src/resolveAppearance.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add client/src/renderer/src/resolveAppearance.js client/src/renderer/src/resolveAppearance.test.js
git commit -m "feat(client): resolveAppearance pure resolution logic"
```

---

### Task 7: `profiles.js` - store/file I/O + resolution + reconciliation

**Files:**
- Create: `client/src/main/profiles.js`

**Interfaces:**
- Consumes: `store` (Task 3), `app.getAppPath()`.
- Produces (all synchronous unless noted):
  - `reconcileFriendProfiles()` → void. Scans `friends/` subfolders; adds a blank `friendProfiles[id]` for any folder id not already a key.
  - `resolveSpeakerProfile({ speakerId, slotIndex })` → `{ avatarSilent, avatarSpeaking, usernameColor, chatColor }` (images as data URLs or null). Precedence: friend entry exists → friend; else `0 <= slotIndex < 10` → default slot; else all nulls.
  - `getDefaultProfiles()` → array(10) of `{ avatarSilent, avatarSpeaking, usernameColor, chatColor }`.
  - `getFriendProfiles()` → `{ [id]: { avatarSilent, avatarSpeaking, usernameColor, chatColor } }`.
  - `pickAvatarImage({ scope, id, kind })` async → new data URL or null. `scope` `'default'|'friend'`, `id` slot dir (`'01'`) or user_id, `kind` `'silent'|'speaking'`. Opens native picker, copies into place deleting other-extension siblings first.
  - `setDefaultProfileColors(slotIndex, { usernameColor, chatColor })` → void.
  - `addFriendProfile(userId)` → void (idempotent blank upsert).
  - `setFriendProfileColors(userId, { usernameColor, chatColor })` → void (upsert).
  - `removeFriendProfile(userId)` → void (delete store entry + `friends/<id>/` recursively).

- [ ] **Step 1: Create `client/src/main/profiles.js`**

```js
import { app, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function avatarsRoot() {
  return path.join(app.getAppPath(), 'resources', 'avatars');
}

function scopeDir(scope, id) {
  const sub = scope === 'friend' ? 'friends' : 'defaults';
  return path.join(avatarsRoot(), sub, id);
}

// Find silent.* / speaking.* by basename; return absolute path or null.
function findAvatarFile(dir, kind) {
  for (const ext of IMAGE_EXTENSIONS) {
    const candidate = path.join(dir, `${kind}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readAvatarDataUrl(dir, kind) {
  const file = findAvatarFile(dir, kind);
  if (!file) return null;
  const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const b64 = fs.readFileSync(file).toString('base64');
  return `data:${mime};base64,${b64}`;
}

function slotDirName(slotIndex) {
  return String(slotIndex + 1).padStart(2, '0');
}

function readImagesFor(scope, id) {
  const dir = scopeDir(scope, id);
  return {
    avatarSilent: readAvatarDataUrl(dir, 'silent'),
    avatarSpeaking: readAvatarDataUrl(dir, 'speaking'),
  };
}

export function reconcileFriendProfiles(store) {
  const friendsDir = path.join(avatarsRoot(), 'friends');
  if (!fs.existsSync(friendsDir)) return;
  const friendProfiles = { ...store.get('friendProfiles') };
  let changed = false;
  for (const entry of fs.readdirSync(friendsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !(entry.name in friendProfiles)) {
      friendProfiles[entry.name] = { usernameColor: null, chatColor: null };
      changed = true;
    }
  }
  if (changed) store.set('friendProfiles', friendProfiles);
}

export function resolveSpeakerProfile(store, { speakerId, slotIndex }) {
  const friend = store.get('friendProfiles')[speakerId];
  if (friend) {
    return {
      ...readImagesFor('friend', speakerId),
      usernameColor: friend.usernameColor ?? null,
      chatColor: friend.chatColor ?? null,
    };
  }
  if (slotIndex >= 0 && slotIndex < 10) {
    const slot = store.get('defaultProfiles')[slotIndex] ?? { usernameColor: null, chatColor: null };
    return {
      ...readImagesFor('default', slotDirName(slotIndex)),
      usernameColor: slot.usernameColor ?? null,
      chatColor: slot.chatColor ?? null,
    };
  }
  return { avatarSilent: null, avatarSpeaking: null, usernameColor: null, chatColor: null };
}

export function getDefaultProfiles(store) {
  const colors = store.get('defaultProfiles');
  return colors.map((slot, i) => ({
    ...readImagesFor('default', slotDirName(i)),
    usernameColor: slot.usernameColor ?? null,
    chatColor: slot.chatColor ?? null,
  }));
}

export function getFriendProfiles(store) {
  const friendProfiles = store.get('friendProfiles');
  const result = {};
  for (const [id, colors] of Object.entries(friendProfiles)) {
    result[id] = {
      ...readImagesFor('friend', id),
      usernameColor: colors.usernameColor ?? null,
      chatColor: colors.chatColor ?? null,
    };
  }
  return result;
}

export async function pickAvatarImage({ scope, id, kind }) {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: `Choose ${kind} avatar image`,
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS.map((e) => e.slice(1)) }],
  });
  if (canceled || filePaths.length === 0) return null;

  const source = filePaths[0];
  const ext = path.extname(source).toLowerCase();
  if (!IMAGE_EXTENSIONS.includes(ext)) return null;

  const dir = scopeDir(scope, id);
  fs.mkdirSync(dir, { recursive: true });
  // Delete any existing kind.* of a different extension so there's no ambiguity.
  for (const existingExt of IMAGE_EXTENSIONS) {
    const existing = path.join(dir, `${kind}${existingExt}`);
    if (existingExt !== ext && fs.existsSync(existing)) fs.rmSync(existing);
  }
  fs.copyFileSync(source, path.join(dir, `${kind}${ext}`));
  return readAvatarDataUrl(dir, kind);
}

export function setDefaultProfileColors(store, slotIndex, colors) {
  const defaultProfiles = store.get('defaultProfiles').slice();
  defaultProfiles[slotIndex] = {
    usernameColor: colors.usernameColor ?? null,
    chatColor: colors.chatColor ?? null,
  };
  store.set('defaultProfiles', defaultProfiles);
}

export function addFriendProfile(store, userId) {
  const friendProfiles = store.get('friendProfiles');
  if (userId in friendProfiles) return;
  store.set('friendProfiles', { ...friendProfiles, [userId]: { usernameColor: null, chatColor: null } });
}

export function setFriendProfileColors(store, userId, colors) {
  const friendProfiles = store.get('friendProfiles');
  store.set('friendProfiles', {
    ...friendProfiles,
    [userId]: { usernameColor: colors.usernameColor ?? null, chatColor: colors.chatColor ?? null },
  });
}

export function removeFriendProfile(store, userId) {
  const friendProfiles = { ...store.get('friendProfiles') };
  delete friendProfiles[userId];
  store.set('friendProfiles', friendProfiles);
  const dir = scopeDir('friend', userId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
```

- [ ] **Step 2: Lint check**

Run: `cd client && npx eslint src/main/profiles.js`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/main/profiles.js
git commit -m "feat(client): profiles.js - profile store/file I/O and resolution"
```

---

### Task 8: Register profile IPC handlers + reconciliation + settings resize + getSettings field

**Files:**
- Modify: `client/src/main/index.js`

**Interfaces:**
- Consumes: everything exported from `profiles.js` (Task 7).
- Produces IPC channels: `resolve-speaker-profile`, `get-default-profiles`, `get-friend-profiles`, `pick-default-avatar-image`, `pick-friend-avatar-image`, `set-default-profile-colors`, `add-friend-profile`, `set-friend-profile-colors`, `remove-friend-profile`, `resize-window`; `get-settings` gains `loggedInUserId`.

- [ ] **Step 1: Import profiles module** - add near the other imports (after line 6):

```js
import {
  reconcileFriendProfiles,
  resolveSpeakerProfile,
  getDefaultProfiles,
  getFriendProfiles,
  pickAvatarImage,
  setDefaultProfileColors,
  addFriendProfile,
  setFriendProfileColors,
  removeFriendProfile,
} from './profiles.js';
```

- [ ] **Step 2: Run reconciliation once at startup** - in `app.whenReady().then(...)` (line 206-210), add `reconcileFriendProfiles(store);` as the first call:

```js
  app.whenReady().then(() => {
    reconcileFriendProfiles(store);
    registerIpcHandlers();
    createLauncherWindow();
    if (deferredOpenUrl) handleDeepLink(deferredOpenUrl);
  });
```

- [ ] **Step 3: Add `loggedInUserId` to `get-settings`** - extend the object (lines 221-226):

```js
  ipcMain.handle('get-settings', () => ({
    serverAddress: store.get('serverAddress'),
    avatarMode: store.get('avatarMode'),
    avatarSize: store.get('avatarSize'),
    hasSessionToken: Boolean(store.get('sessionToken')),
    loggedInUserId: store.get('loggedInUserId'),
  }));
```

- [ ] **Step 4: Register the profile + resize handlers** - add inside `registerIpcHandlers()` (before its closing brace, after the `window-is-maximized` handler):

```js
  ipcMain.handle('resolve-speaker-profile', (_event, args) => resolveSpeakerProfile(store, args));
  ipcMain.handle('get-default-profiles', () => getDefaultProfiles(store));
  ipcMain.handle('get-friend-profiles', () => getFriendProfiles(store));
  ipcMain.handle('pick-default-avatar-image', (_event, { slotIndex, kind }) =>
    pickAvatarImage({ scope: 'default', id: String(slotIndex + 1).padStart(2, '0'), kind }),
  );
  ipcMain.handle('pick-friend-avatar-image', (_event, { userId, kind }) =>
    pickAvatarImage({ scope: 'friend', id: userId, kind }),
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
```

- [ ] **Step 5: Lint check**

Run: `cd client && npx eslint src/main/index.js`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/main/index.js
git commit -m "feat(client): register profile IPC handlers, reconciliation, window resize"
```

---

### Task 9: Preload - expose the new IPC surface

**Files:**
- Modify: `client/src/preload/index.cjs`

**Interfaces:**
- Consumes: the IPC channels from Task 8.
- Produces on `window.api`: `resolveSpeakerProfile`, `getDefaultProfiles`, `getFriendProfiles`, `pickDefaultAvatarImage(slotIndex, kind)`, `pickFriendAvatarImage(userId, kind)`, `setDefaultProfileColors(slotIndex, colors)`, `addFriendProfile(userId)`, `setFriendProfileColors(userId, colors)`, `removeFriendProfile(userId)`, `resizeWindow(width, height)`.

- [ ] **Step 1: Add wrappers** - inside the `exposeInMainWorld('api', { ... })` object (before its closing brace):

```js
  resolveSpeakerProfile: (args) => ipcRenderer.invoke('resolve-speaker-profile', args),
  getDefaultProfiles: () => ipcRenderer.invoke('get-default-profiles'),
  getFriendProfiles: () => ipcRenderer.invoke('get-friend-profiles'),
  pickDefaultAvatarImage: (slotIndex, kind) => ipcRenderer.invoke('pick-default-avatar-image', { slotIndex, kind }),
  pickFriendAvatarImage: (userId, kind) => ipcRenderer.invoke('pick-friend-avatar-image', { userId, kind }),
  setDefaultProfileColors: (slotIndex, colors) =>
    ipcRenderer.invoke('set-default-profile-colors', { slotIndex, colors }),
  addFriendProfile: (userId) => ipcRenderer.invoke('add-friend-profile', userId),
  setFriendProfileColors: (userId, colors) => ipcRenderer.invoke('set-friend-profile-colors', { userId, colors }),
  removeFriendProfile: (userId) => ipcRenderer.invoke('remove-friend-profile', userId),
  resizeWindow: (width, height) => ipcRenderer.invoke('resize-window', { width, height }),
```

- [ ] **Step 2: Commit**

```bash
git add client/src/preload/index.cjs
git commit -m "feat(client): expose profile + resize IPC on window.api"
```

---

### Task 10: ChatView / SpeakerStrip / MessageLog - consume resolved profiles

**Files:**
- Modify: `client/src/renderer/src/ChatView.jsx`
- Modify: `client/src/renderer/src/SpeakerStrip.jsx`
- Modify: `client/src/renderer/src/MessageLog.jsx`

**Interfaces:**
- Consumes: `window.api.resolveSpeakerProfile`, `window.api.getFriendProfiles`, `resolveAppearance` (Task 6).
- Produces: SpeakerStrip receives `profileBySpeaker` + `avatarMode` + `speakingIds`, computes `avatarSrc` via `resolveAppearance`. MessageLog receives `colorBySpeaker` and applies inline styles.

- [ ] **Step 1: Rewrite `ChatView.jsx`** - replace the `customAvatars` import and the `avatarIndexBySpeaker`/`assignCustomAvatars` mechanism with async profile resolution. Full file:

```jsx
import { useEffect, useRef, useState } from 'react';
import SpeakerStrip from './SpeakerStrip';
import MessageLog, { MESSAGE_VISIBLE_MS, MESSAGE_FADE_MS } from './MessageLog';
import WindowMenu from './WindowMenu';

function mergeEntries(current, incoming) {
  const merged = new Map();
  for (const entry of current) merged.set(`${entry.speakerId}-${entry.receivedAt}`, entry);
  for (const entry of incoming) merged.set(`${entry.speakerId}-${entry.receivedAt}`, entry);
  return [...merged.values()].sort((a, b) => a.receivedAt - b.receivedAt);
}

function ChatFrame({ header = null, panelClass = '', avatarSize = 'small', onAvatarSizeChange, children }) {
  return (
    <div className="chat-root">
      <div className={`chat-header chat-header--${avatarSize}`}>{header}</div>
      <div className={`chat-panel ${panelClass}`.trim()}>
        <WindowMenu avatarSize={onAvatarSizeChange ? avatarSize : undefined} onAvatarSizeChange={onAvatarSizeChange} />
        {children}
      </div>
    </div>
  );
}

export default function ChatView() {
  const [roster, setRoster] = useState([]);
  const [speakingIds, setSpeakingIds] = useState(new Set());
  const [entries, setEntries] = useState([]);
  const [interimBySpeaker, setInterimBySpeaker] = useState({});
  const [settings, setSettings] = useState(null);
  const [connectionState, setConnectionState] = useState({ status: 'connected' });

  // speakerId -> resolved { avatarSilent, avatarSpeaking, usernameColor, chatColor }.
  // Resolved once per newly-seen speaker (cached), mirroring the old
  // avatarIndexBySpeaker ref. Friends don't consume a default slot, so the slot
  // counter only advances for non-friends - which requires knowing the friend
  // set before assigning slots (loaded once into friendIds).
  const [profileBySpeaker, setProfileBySpeaker] = useState({});
  const [friendIds, setFriendIds] = useState(null); // null = not loaded yet
  const requestedRef = useRef(new Set());
  const slotCounterRef = useRef(0);

  useEffect(() => {
    window.api.getFriendProfiles().then((friends) => setFriendIds(new Set(Object.keys(friends))));
  }, []);

  // Resolve profiles for any roster members not yet requested - gated on the
  // friend set being loaded so slot assignment can skip friends correctly.
  useEffect(() => {
    if (!friendIds) return;
    for (const member of roster) {
      if (requestedRef.current.has(member.speakerId)) continue;
      requestedRef.current.add(member.speakerId);
      const slotIndex = friendIds.has(member.speakerId) ? -1 : slotCounterRef.current++;
      window.api.resolveSpeakerProfile({ speakerId: member.speakerId, slotIndex }).then((profile) => {
        setProfileBySpeaker((prev) => ({ ...prev, [member.speakerId]: profile }));
      });
    }
  }, [roster, friendIds]);

  function handleAvatarSizeChange(avatarSize) {
    setSettings((prev) => (prev ? { ...prev, avatarSize } : prev));
    window.api.setSettings({ avatarSize });
  }

  useEffect(() => {
    window.api.getSettings().then(setSettings);
    const unsubscribes = [
      window.api.onConnectionState(setConnectionState),
      window.api.onRoster(setRoster),
      window.api.onSpeaking(({ speakerId, isSpeaking }) => {
        setSpeakingIds((prev) => {
          const next = new Set(prev);
          if (isSpeaking) next.add(speakerId);
          else next.delete(speakerId);
          return next;
        });
      }),
      window.api.onTranscript((event) => {
        if (event.isFinal) {
          setEntries((prev) => [...prev, event]);
          setInterimBySpeaker((prev) => {
            const next = { ...prev };
            delete next[event.speakerId];
            return next;
          });
        } else {
          setInterimBySpeaker((prev) => ({ ...prev, [event.speakerId]: event }));
        }
      }),
    ];
    window.api.getStateSnapshot().then((snapshot) => {
      setRoster(snapshot.roster);
      setEntries((prev) => mergeEntries(prev, snapshot.messageLog));
      setConnectionState(snapshot.connectionState);
    });
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - (MESSAGE_VISIBLE_MS + MESSAGE_FADE_MS);
      setEntries((prev) => prev.filter((entry) => entry.receivedAt >= cutoff));
    }, 250);
    return () => clearInterval(interval);
  }, []);

  if (connectionState.status === 'auth-failed' && connectionState.reason === 'not in voice channel') {
    return (
      <ChatFrame panelClass="chat-panel--message">
        <p>You need to be in the voice channel being captioned.</p>
        <button onClick={() => window.api.startChatWindow()}>Retry</button>
      </ChatFrame>
    );
  }
  if (connectionState.status === 'auth-failed') {
    return (
      <ChatFrame panelClass="chat-panel--message">
        <p>Your session expired - please log in again.</p>
        <button disabled={!settings} onClick={() => settings && window.api.openLogin(settings.serverAddress)}>
          Log in
        </button>
      </ChatFrame>
    );
  }
  if (connectionState.status === 'unreachable') {
    return (
      <ChatFrame panelClass="chat-panel--message">
        <p>Can't reach {connectionState.serverAddress} - still retrying in the background.</p>
        <button onClick={() => window.api.focusLauncherSettings()}>Edit server address in Settings</button>
      </ChatFrame>
    );
  }
  if (connectionState.status === 'reconnecting') {
    return (
      <ChatFrame panelClass="chat-panel--message">
        <p>Reconnecting…</p>
      </ChatFrame>
    );
  }

  const avatarSize = settings?.avatarSize ?? 'small';
  const avatarMode = settings?.avatarMode ?? 'discord';
  const colorBySpeaker = Object.fromEntries(
    Object.entries(profileBySpeaker).map(([id, p]) => [id, { usernameColor: p.usernameColor, chatColor: p.chatColor }]),
  );

  return (
    <ChatFrame
      avatarSize={avatarSize}
      onAvatarSizeChange={handleAvatarSizeChange}
      header={
        <SpeakerStrip
          roster={roster}
          speakingIds={speakingIds}
          avatarMode={avatarMode}
          avatarSize={avatarSize}
          profileBySpeaker={profileBySpeaker}
        />
      }
    >
      <MessageLog entries={entries} interimBySpeaker={interimBySpeaker} colorBySpeaker={colorBySpeaker} />
    </ChatFrame>
  );
}
```

- [ ] **Step 2: Rewrite `SpeakerStrip.jsx`** to compute `avatarSrc` via `resolveAppearance`:

```jsx
import './SpeakerStrip.css';
import { resolveAppearance } from './resolveAppearance';

const EMPTY_PROFILE = { avatarSilent: null, avatarSpeaking: null, usernameColor: null, chatColor: null };

export default function SpeakerStrip({ roster, speakingIds, avatarMode, avatarSize = 'small', profileBySpeaker = {} }) {
  return (
    <div className={`speaker-strip speaker-strip--${avatarSize}`}>
      {roster.map((member) => {
        const isSpeaking = speakingIds.has(member.speakerId);
        const { avatarSrc } = resolveAppearance({
          avatarMode,
          isSpeaking,
          discordAvatarURL: member.avatarURL,
          profile: profileBySpeaker[member.speakerId] ?? EMPTY_PROFILE,
        });
        return (
          <div key={member.speakerId} className={`speaker speaker--${avatarSize}`}>
            <img
              src={avatarSrc}
              alt={member.username}
              className={[
                'speaker-icon',
                avatarMode === 'discord' ? 'speaker-icon--discord' : 'speaker-icon--custom',
                `speaker-icon--${avatarSize}`,
                isSpeaking ? 'speaker-icon--speaking' : '',
              ].filter(Boolean).join(' ')}
            />
            {(member.isDeafened || member.isMuted) && (
              <span className="speaker-badge" title={member.isDeafened ? 'Deafened' : 'Muted'}>
                {member.isDeafened ? '🎧' : '🎤'}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

Note: in custom mode a member's `speaker-icon--custom` class was previously applied whenever custom mode was active. Keep that behavior (class keyed on `avatarMode`, unchanged) even though `avatarSrc` may fall back to the Discord URL - matches today's markup.

- [ ] **Step 3: Update `MessageLog.jsx`** to apply per-speaker color overrides. Replace `MessageLine` and `MessageLog`:

```jsx
function MessageLine({ entry, interim = false, colors = {} }) {
  const isFading = !interim && Date.now() - entry.receivedAt >= MESSAGE_VISIBLE_MS;
  return (
    <div
      className={[
        'message-line',
        interim ? 'message-line--interim' : '',
        isFading ? 'message-line--fading' : '',
      ].filter(Boolean).join(' ')}
    >
      <img src={entry.avatarURL} alt="" className="message-line-avatar" />
      <div className="message-line-body">
        <div className="message-line-username" style={colors.usernameColor ? { color: colors.usernameColor } : undefined}>
          {entry.username}
        </div>
        <div className="message-line-text" style={colors.chatColor ? { color: colors.chatColor } : undefined}>
          {entry.text}
        </div>
      </div>
    </div>
  );
}

export default function MessageLog({ entries, interimBySpeaker, colorBySpeaker = {} }) {
  const interimEntries = Object.values(interimBySpeaker);
  return (
    <div className="message-log">
      {entries.map((entry) => (
        <MessageLine key={`${entry.speakerId}-${entry.receivedAt}`} entry={entry} colors={colorBySpeaker[entry.speakerId]} />
      ))}
      {interimEntries.map((entry) => (
        <MessageLine key={entry.speakerId} entry={entry} interim colors={colorBySpeaker[entry.speakerId]} />
      ))}
    </div>
  );
}
```

(Keep the existing `MESSAGE_VISIBLE_MS`/`MESSAGE_FADE_MS` export block unchanged, including the uncommitted `10000` value.)

- [ ] **Step 4: Lint check**

Run: `cd client && npx eslint src/renderer/src/ChatView.jsx src/renderer/src/SpeakerStrip.jsx src/renderer/src/MessageLog.jsx`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/renderer/src/ChatView.jsx client/src/renderer/src/SpeakerStrip.jsx client/src/renderer/src/MessageLog.jsx
git commit -m "feat(client): chat window consumes resolved per-speaker profiles"
```

---

### Task 11: Settings UI - `ProfileFieldsEditor` + section components + `SettingsView`

**Files:**
- Create: `client/src/renderer/src/settings/ProfileFieldsEditor.jsx`
- Create: `client/src/renderer/src/settings/YourProfileSection.jsx`
- Create: `client/src/renderer/src/settings/DefaultSlotsSection.jsx`
- Create: `client/src/renderer/src/settings/FriendOverridesSection.jsx`
- Create: `client/src/renderer/src/settings/SettingsView.jsx`

**Interfaces:**
- Consumes: all `window.api` profile methods (Task 9).
- `ProfileFieldsEditor` props: `{ layout: 'row'|'card', profile, onPickAvatar(kind), onClearAvatar(kind), onSetColor(field, value), onClearColor(field) }` where `profile` is `{ avatarSilent, avatarSpeaking, usernameColor, chatColor }`.
- Produces: `<SettingsView onBack />` default export, composing Connection settings + the three sections.

- [ ] **Step 1: Create `ProfileFieldsEditor.jsx`** (shared 4-field editor, row/card layout):

```jsx
// One editor, three call sites (Your Profile card, each Default Slot row, each
// Friend card). Avatar fields: thumbnail (or dashed "+" placeholder) with
// Change and Clear. Color fields: swatch (or dashed placeholder) with a native
// color input and Clear. "Clear" nulls that one field → universal fallback.
function AvatarField({ label, src, onPick, onClear }) {
  return (
    <div className="pf-field">
      <span className="pf-label">{label}</span>
      {src ? (
        <img className="pf-avatar" src={src} alt={label} />
      ) : (
        <div className="pf-avatar pf-avatar--empty" aria-hidden="true">+</div>
      )}
      <div className="pf-actions">
        <button className="pf-btn" onClick={onPick}>{src ? 'Change' : 'Add'}</button>
        {src && <button className="pf-btn pf-btn--muted" onClick={onClear}>Clear</button>}
      </div>
    </div>
  );
}

function ColorField({ label, value, onSet, onClear }) {
  return (
    <div className="pf-field">
      <span className="pf-label">{label}</span>
      <label className={`pf-swatch ${value ? '' : 'pf-swatch--empty'}`} style={value ? { background: value } : undefined}>
        {!value && <span aria-hidden="true">+</span>}
        <input
          className="pf-color-input"
          type="color"
          value={value ?? '#ffffff'}
          onChange={(e) => onSet(e.target.value)}
        />
      </label>
      <div className="pf-actions">
        {value && <button className="pf-btn pf-btn--muted" onClick={onClear}>Clear</button>}
      </div>
    </div>
  );
}

export default function ProfileFieldsEditor({ layout, profile, onPickAvatar, onClearAvatar, onSetColor, onClearColor }) {
  return (
    <div className={`profile-fields profile-fields--${layout}`}>
      <AvatarField label="Silent" src={profile.avatarSilent} onPick={() => onPickAvatar('silent')} onClear={() => onClearAvatar('silent')} />
      <AvatarField label="Speaking" src={profile.avatarSpeaking} onPick={() => onPickAvatar('speaking')} onClear={() => onClearAvatar('speaking')} />
      <ColorField label="Name color" value={profile.usernameColor} onSet={(v) => onSetColor('usernameColor', v)} onClear={() => onClearColor('usernameColor')} />
      <ColorField label="Chat color" value={profile.chatColor} onSet={(v) => onSetColor('chatColor', v)} onClear={() => onClearColor('chatColor')} />
    </div>
  );
}
```

Note on Clear-avatar: there is no dedicated "delete avatar file" IPC in the spec's write surface (§5). Clearing an avatar is achieved by the universal fallback at resolution time only when no file exists; since the picker writes real files, "Clear" for an avatar must remove the file. Add a delete path in Task 7? - Not needed: re-scope. **Decision:** avatar "Clear" is implemented by `removeFriendProfile`-style file deletion is out of scope; instead the Clear affordance on *avatars* deletes via a new lightweight handler. To avoid expanding scope mid-plan, this plan implements avatar Clear by calling a new `clear-avatar-image` IPC. See Step 1a.

- [ ] **Step 1a: Add `clearAvatarImage` to the backend** (small addition the shared editor needs for avatar Clear):

In `client/src/main/profiles.js` add:

```js
export function clearAvatarImage({ scope, id, kind }) {
  const dir = scopeDir(scope, id);
  for (const ext of IMAGE_EXTENSIONS) {
    const file = path.join(dir, `${kind}${ext}`);
    if (fs.existsSync(file)) fs.rmSync(file);
  }
}
```

In `client/src/main/index.js` add handlers:

```js
  ipcMain.handle('clear-default-avatar-image', (_event, { slotIndex, kind }) =>
    clearAvatarImage({ scope: 'default', id: String(slotIndex + 1).padStart(2, '0'), kind }),
  );
  ipcMain.handle('clear-friend-avatar-image', (_event, { userId, kind }) =>
    clearAvatarImage({ scope: 'friend', id: userId, kind }),
  );
```

and import `clearAvatarImage` in the profiles import block.

In `client/src/preload/index.cjs` add:

```js
  clearDefaultAvatarImage: (slotIndex, kind) => ipcRenderer.invoke('clear-default-avatar-image', { slotIndex, kind }),
  clearFriendAvatarImage: (userId, kind) => ipcRenderer.invoke('clear-friend-avatar-image', { userId, kind }),
```

- [ ] **Step 2: Create `DefaultSlotsSection.jsx`**:

```jsx
import ProfileFieldsEditor from './ProfileFieldsEditor';

export default function DefaultSlotsSection({ profiles, onChange }) {
  async function update(slotIndex, mutate) {
    await mutate();
    onChange();
  }
  return (
    <section className="settings-section">
      <h3 className="settings-heading">Default Slots (10)</h3>
      <p className="settings-subtext">Assigned by join order to speakers without a friend profile.</p>
      <div className="slot-rows">
        {profiles.map((profile, slotIndex) => (
          <div key={slotIndex} className="slot-row">
            <span className="slot-number">{slotIndex + 1}</span>
            <ProfileFieldsEditor
              layout="row"
              profile={profile}
              onPickAvatar={(kind) => update(slotIndex, () => window.api.pickDefaultAvatarImage(slotIndex, kind))}
              onClearAvatar={(kind) => update(slotIndex, () => window.api.clearDefaultAvatarImage(slotIndex, kind))}
              onSetColor={(field, value) =>
                update(slotIndex, () =>
                  window.api.setDefaultProfileColors(slotIndex, { ...colorsOf(profile), [field]: value }),
                )
              }
              onClearColor={(field) =>
                update(slotIndex, () =>
                  window.api.setDefaultProfileColors(slotIndex, { ...colorsOf(profile), [field]: null }),
                )
              }
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function colorsOf(profile) {
  return { usernameColor: profile.usernameColor, chatColor: profile.chatColor };
}
```

- [ ] **Step 3: Create `FriendOverridesSection.jsx`**:

```jsx
import { useState } from 'react';
import ProfileFieldsEditor from './ProfileFieldsEditor';

function colorsOf(profile) {
  return { usernameColor: profile.usernameColor, chatColor: profile.chatColor };
}

export default function FriendOverridesSection({ friends, onChange }) {
  const [newId, setNewId] = useState('');

  async function update(userId, mutate) {
    await mutate();
    onChange();
  }

  async function addFriend() {
    const id = newId.trim();
    if (!id) return;
    await window.api.addFriendProfile(id);
    setNewId('');
    onChange();
  }

  return (
    <section className="settings-section">
      <h3 className="settings-heading">Friend Overrides</h3>
      <div className="friend-cards">
        {Object.entries(friends).map(([userId, profile]) => (
          <div key={userId} className="friend-card">
            <button
              className="friend-remove"
              aria-label="Remove friend profile"
              onClick={() => update(userId, () => window.api.removeFriendProfile(userId))}
            >
              Remove
            </button>
            <div className="friend-id">{userId}</div>
            <ProfileFieldsEditor
              layout="card"
              profile={profile}
              onPickAvatar={(kind) => update(userId, () => window.api.pickFriendAvatarImage(userId, kind))}
              onClearAvatar={(kind) => update(userId, () => window.api.clearFriendAvatarImage(userId, kind))}
              onSetColor={(field, value) =>
                update(userId, () => window.api.setFriendProfileColors(userId, { ...colorsOf(profile), [field]: value }))
              }
              onClearColor={(field) =>
                update(userId, () => window.api.setFriendProfileColors(userId, { ...colorsOf(profile), [field]: null }))
              }
            />
          </div>
        ))}
        <div className="friend-card friend-card--add">
          <div className="friend-id">Add friend profile</div>
          <div className="friend-add-row">
            <input
              placeholder="Discord user ID"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addFriend()}
            />
            <button onClick={addFriend}>+ Add</button>
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create `YourProfileSection.jsx`**:

```jsx
import ProfileFieldsEditor from './ProfileFieldsEditor';

function colorsOf(profile) {
  return { usernameColor: profile.usernameColor, chatColor: profile.chatColor };
}

// Mechanically a friend profile keyed by loggedInUserId, given pinned styling.
export default function YourProfileSection({ loggedInUserId, profile, onChange }) {
  if (!loggedInUserId) {
    return (
      <section className="settings-section your-profile your-profile--disabled">
        <h3 className="settings-heading">Your Profile</h3>
        <p className="settings-subtext">Log in to configure your own profile.</p>
      </section>
    );
  }

  const current = profile ?? { avatarSilent: null, avatarSpeaking: null, usernameColor: null, chatColor: null };
  async function update(mutate) {
    await mutate();
    onChange();
  }

  return (
    <section className="settings-section your-profile">
      <h3 className="settings-heading">Your Profile</h3>
      <ProfileFieldsEditor
        layout="card"
        profile={current}
        onPickAvatar={(kind) => update(() => window.api.pickFriendAvatarImage(loggedInUserId, kind))}
        onClearAvatar={(kind) => update(() => window.api.clearFriendAvatarImage(loggedInUserId, kind))}
        onSetColor={(field, value) =>
          update(() => window.api.setFriendProfileColors(loggedInUserId, { ...colorsOf(current), [field]: value }))
        }
        onClearColor={(field) =>
          update(() => window.api.setFriendProfileColors(loggedInUserId, { ...colorsOf(current), [field]: null }))
        }
      />
    </section>
  );
}
```

- [ ] **Step 5: Create `SettingsView.jsx`** (composes everything, owns Back + resize + Connection settings):

```jsx
import { useEffect, useState } from 'react';
import YourProfileSection from './YourProfileSection';
import DefaultSlotsSection from './DefaultSlotsSection';
import FriendOverridesSection from './FriendOverridesSection';

export default function SettingsView({ settings, onSettingsChange, onBack }) {
  const [defaultProfiles, setDefaultProfiles] = useState([]);
  const [friendProfiles, setFriendProfiles] = useState({});

  function reload() {
    window.api.getDefaultProfiles().then(setDefaultProfiles);
    window.api.getFriendProfiles().then(setFriendProfiles);
  }

  useEffect(() => {
    window.api.resizeWindow(640, 560);
    reload();
    return () => window.api.resizeWindow(360, 480);
  }, []);

  const loggedInUserId = settings.loggedInUserId;
  const yourProfile = loggedInUserId ? friendProfiles[loggedInUserId] : null;
  const otherFriends = Object.fromEntries(
    Object.entries(friendProfiles).filter(([id]) => id !== loggedInUserId),
  );

  return (
    <div className="settings-view">
      <div className="settings-topbar">
        <button onClick={onBack}>← Back</button>
      </div>
      <div className="settings-scroll">
        <section className="settings-section">
          <h3 className="settings-heading">Connection</h3>
          <label className="settings-field">
            Server address
            <input
              value={settings.serverAddress}
              onChange={(e) => onSettingsChange({ serverAddress: e.target.value }, false)}
              onBlur={(e) => window.api.setSettings({ serverAddress: e.target.value })}
            />
          </label>
          <label className="settings-field">
            Avatar mode
            <select
              value={settings.avatarMode}
              onChange={(e) => {
                onSettingsChange({ avatarMode: e.target.value }, true);
              }}
            >
              <option value="discord">Discord avatar</option>
              <option value="custom">Custom image</option>
            </select>
          </label>
        </section>

        <YourProfileSection loggedInUserId={loggedInUserId} profile={yourProfile} onChange={reload} />
        <DefaultSlotsSection profiles={defaultProfiles} onChange={reload} />
        <FriendOverridesSection friends={otherFriends} onChange={reload} />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Lint check**

Run: `cd client && npx eslint src/renderer/src/settings/`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/renderer/src/settings client/src/main/profiles.js client/src/main/index.js client/src/preload/index.cjs
git commit -m "feat(client): Settings page components + avatar-clear IPC"
```

---

### Task 12: LauncherView - simplified main page + page toggle to SettingsView

**Files:**
- Modify: `client/src/renderer/src/LauncherView.jsx`

**Interfaces:**
- Consumes: `SettingsView` (Task 11).
- Produces: launcher main page (Settings / Start Chat Window / Log out) toggling to `<SettingsView />` via local `page` state.

- [ ] **Step 1: Rewrite `LauncherView.jsx`**:

```jsx
import { useEffect, useState } from 'react';
import TitleBar from './TitleBar';
import SettingsView from './settings/SettingsView';

export default function LauncherView() {
  const [settings, setSettings] = useState(null);
  const [page, setPage] = useState('main');
  const [loginError, setLoginError] = useState(null);

  useEffect(() => {
    window.api.getSettings().then(setSettings);
    const unsubscribes = [
      window.api.onAuthToken(() => {
        window.api.getSettings().then(setSettings);
        setLoginError(null);
      }),
      window.api.onAuthError((reason) => {
        setLoginError(
          reason === 'access_denied' ? 'Login was cancelled.' : 'Login failed - please try again.',
        );
      }),
      window.api.onOpenSettings(() => setPage('settings')),
    ];
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, []);

  if (!settings) return null;

  function handleStartChatWindow() {
    if (!settings.hasSessionToken) {
      setLoginError(null);
      window.api.openLogin(settings.serverAddress).catch(() =>
        setLoginError('Could not reach the login page - check the server address in Settings and try again.'),
      );
      return;
    }
    window.api.startChatWindow();
  }

  // Optimistic local settings update; `persist` also writes through to the store.
  function handleSettingsChange(partial, persist) {
    setSettings((s) => ({ ...s, ...partial }));
    if (persist) window.api.setSettings(partial);
  }

  return (
    <div className="launcher-root">
      <TitleBar title="discord-echo" />
      {page === 'settings' ? (
        <SettingsView
          settings={settings}
          onSettingsChange={handleSettingsChange}
          onBack={() => setPage('main')}
        />
      ) : (
        <div className="launcher-content">
          {loginError && (
            <div role="alert">
              <p>{loginError}</p>
              <button onClick={handleStartChatWindow}>Retry</button>
            </div>
          )}
          <button onClick={() => setPage('settings')}>Settings</button>
          <button onClick={handleStartChatWindow}>Start Chat Window</button>
          {settings.hasSessionToken && (
            <button onClick={() => window.api.logout().then(() => window.api.getSettings().then(setSettings))}>
              Log out
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Lint check**

Run: `cd client && npx eslint src/renderer/src/LauncherView.jsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/renderer/src/LauncherView.jsx
git commit -m "feat(client): launcher main page + Settings page toggle"
```

---

### Task 13: Settings CSS + cleanup of the old avatar system + test script

**Files:**
- Modify: `client/src/renderer/src/assets/app.css`
- Delete: `client/src/renderer/src/assets/avatars/` (all PNGs + README.md)
- Delete: `client/src/renderer/src/customAvatars.js`
- Modify: `client/package.json` (test script)

**Interfaces:**
- Consumes: class names emitted by Task 11 components.

- [ ] **Step 1: Append settings styles to `app.css`** (reuse theme values):

```css
/* --- settings page (launcher) --- */
.settings-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #1e1f24;
}

.settings-topbar {
  flex: none;
  padding: 8px 12px;
  border-bottom: 1px solid #26272d;
}

.settings-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-section {
  background: #26272d;
  border-radius: 8px;
  padding: 12px;
}

.settings-heading {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
}

.settings-subtext {
  margin: 0 0 10px;
  font-size: 12px;
  opacity: 0.6;
}

.settings-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  margin-bottom: 8px;
}

/* Your Profile - pinned, accent-bordered */
.your-profile {
  border: 1px solid #5865f2;
}
.your-profile--disabled {
  opacity: 0.7;
}

/* shared ProfileFieldsEditor */
.profile-fields {
  display: flex;
  gap: 12px;
}
.profile-fields--row {
  flex-direction: row;
  align-items: flex-start;
  flex-wrap: wrap;
}
.profile-fields--card {
  flex-direction: row;
  flex-wrap: wrap;
}

.pf-field {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.pf-label {
  font-size: 11px;
  opacity: 0.7;
}
.pf-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  object-fit: cover;
  background: #1e1f24;
}
.pf-avatar--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed #46474f;
  color: #46474f;
  font-size: 20px;
}
.pf-swatch {
  position: relative;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
}
.pf-swatch--empty {
  border: 1px dashed #46474f;
  color: #46474f;
}
.pf-color-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  padding: 0;
  border: none;
}
.pf-actions {
  display: flex;
  gap: 4px;
}
.pf-btn {
  padding: 2px 8px;
  font-size: 11px;
}
.pf-btn--muted {
  background: transparent;
  opacity: 0.7;
}
.pf-btn--muted:hover {
  background: #3a3b42;
}

/* default slot rows */
.slot-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.slot-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 8px;
  background: #1e1f24;
  border-radius: 6px;
}
.slot-number {
  font-weight: 600;
  opacity: 0.6;
  min-width: 16px;
}

/* friend cards */
.friend-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.friend-card {
  position: relative;
  background: #1e1f24;
  border-radius: 6px;
  padding: 12px;
}
.friend-remove {
  position: absolute;
  top: 8px;
  right: 8px;
  background: #e81123;
  color: #fff;
  font-size: 11px;
  padding: 3px 8px;
}
.friend-remove:hover {
  background: #f01c2c;
}
.friend-id {
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 12px;
  opacity: 0.8;
  margin-bottom: 10px;
}
.friend-add-row {
  display: flex;
  gap: 8px;
}
.friend-add-row input {
  flex: 1;
}
```

- [ ] **Step 2: Remove the old avatar system** (no code imports it after Task 10):

```bash
git rm -r client/src/renderer/src/assets/avatars
git rm client/src/renderer/src/customAvatars.js
```

- [ ] **Step 3: Add `resolveAppearance.test.js` to the test script** in `client/package.json`:

```json
    "test": "node --test src/main/protocolUrl.test.js src/main/backoff.test.js src/main/wsClient.test.js src/renderer/src/resolveAppearance.test.js"
```

- [ ] **Step 4: Verify nothing still references the removed files**

Run: `cd client && grep -rn "customAvatars\|assets/avatars" src/ ; echo done`
Expected: only `done` (no matches).

- [ ] **Step 5: Run the full test suite**

Run: `cd client && npm test`
Expected: PASS (all suites, including resolveAppearance).

- [ ] **Step 6: Build check** (catches broken imports the renderer bundler would hit)

Run: `cd client && npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add client/src/renderer/src/assets/app.css client/package.json
git commit -m "feat(client): settings page styles; remove legacy avatar system"
```

---

### Task 14: Manual verification pass

**Files:** none (manual).

- [ ] **Step 1:** `cd client && npm run dev`. Launcher opens at 360×480 with Settings / Start Chat Window (+ Log out if logged in).
- [ ] **Step 2:** Click **Settings** → window grows to ~640×560; Connection, Your Profile, Default Slots (10 rows), Friend Overrides render. Click **← Back** → shrinks to 360×480.
- [ ] **Step 3:** Pick a silent image for slot 03 → thumbnail updates immediately. Restart app → still there (file on disk). Replace `resources/avatars/defaults/03/silent.png` by hand with a different file → restart → picked up.
- [ ] **Step 4:** Set a name color + chat color on a slot → swatches fill; Clear → back to dashed.
- [ ] **Step 5:** Add a friend by user_id → card appears. Create `resources/avatars/friends/<some-id>/silent.png` by hand → restart → that id shows as a card (reconciliation). Remove a friend → card gone and `friends/<id>/` deleted.
- [ ] **Step 6:** Log in; open Settings → "Your Profile" is editable and accent-bordered. Log out → "Your Profile" shows the disabled "Log in to configure…" placeholder.
- [ ] **Step 7:** With avatar mode = Custom and default images present, start a chat window while a captioned voice channel is active → first 10 non-friend speakers show slot images (speaking image while speaking if present), colors apply to username/message text in both avatar modes. A friend speaker shows their friend images/colors without consuming a slot.

---

## Self-Review

**Spec coverage:**
- §3.1 filesystem avatars → Tasks 5, 7 (`findAvatarFile`/`pickAvatarImage`, basename glob, other-ext deletion). ✓
- §3.2 store shape + reconciliation → Tasks 3, 7 (`reconcileFriendProfiles`), 8 (startup call). ✓
- §4 resolution algorithm → Task 6 (`resolveAppearance`), Task 7 (`resolveSpeakerProfile` precedence). ✓
- §5 IPC surface → Tasks 7–9 (+ avatar Clear added in Task 11 Step 1a, a spec gap surfaced below). ✓
- §6 learning user_id → Tasks 1, 2, 4, 8 (getSettings field). ✓
- §7 UI/nav/layout/shared component → Tasks 11, 12, 13. ✓
- §8 repo structure → Tasks 5 (add), 13 (remove), all modify tasks. ✓
- §9 testing → Tasks 2, 6 tests; Task 13 wires test script; Task 14 manual. ✓

**Spec gap surfaced (not a placeholder):** §7.3 requires a "Clear" affordance on *avatar* fields, but §5's write surface only lists color setters and image *pickers* - no image delete. Task 11 Step 1a adds a minimal `clearAvatarImage` + two IPC channels to satisfy the required UI without inventing broader scope. Flagged for reviewer awareness.

**Type consistency:** `resolveSpeakerProfile`/`getDefaultProfiles`/`getFriendProfiles` all return the same 4-field shape `{ avatarSilent, avatarSpeaking, usernameColor, chatColor }` consumed identically by `resolveAppearance` (Task 6/10) and `ProfileFieldsEditor` (Task 11). Slot dir naming `String(slotIndex + 1).padStart(2, '0')` is identical in `profiles.js` and the two index.js pick/clear handlers. `resize-window` payload `{ width, height }` matches preload `resizeWindow(width, height)`.
