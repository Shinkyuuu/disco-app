# Discord Login Button & Profile Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated "Login to Discord" button to the launcher (shown while logged out) and a profile header (shown while logged in) displaying the user's avatar, username, user_id, Discord presence, tracked-voice-channel membership, and discord-echo server reachability.

**Architecture:** Display identity (username/avatar) is read from the bot's existing guild-member cache in `bot.js` — the same source already used for roster/speaker attribution — not from OAuth. A new `GET /api/me` HTTP endpoint (session-token authenticated, decoupled from the caption WebSocket's auth gate) exposes that plus Discord presence and tracked-channel membership. The Electron client polls it every 15s while the launcher is open and pushes updates over IPC to a new `ProfileHeader` component.

**Tech Stack:** Node.js (`node:test`, `node:http`), discord.js 14, `ws`, Electron 39 (ESM main, CJS preload), React 19.

## Global Constraints

- **Identity source:** username/avatar always come from `bot.js`'s guild member cache (`member.displayName`/`member.displayAvatarURL(...)`), never from OAuth. `auth.js` is **not modified** by this plan.
- **Manual prerequisite (not code):** enabling `GatewayIntentBits.GuildPresences` in code requires also toggling "Presence Intent" on for this bot application in the Discord Developer Portal (Bot tab). Without that toggle, `member.presence` stays `undefined` regardless of the code change.
- **"Connection status" = discord-echo server reachability** (did the last `/api/me` poll succeed), derived independently of the caption WebSocket. The caption WS's existing lazy start-on-demand behavior (only connects when "Start Chat Window" is clicked) is **not changed**.
- **Poll interval:** 15000ms, running whenever a session token exists and the launcher window is open; starts on login and at startup (if already logged in), stops on logout and launcher-window-close.
- **No persistence** of username/avatar/status in `electron-store` — always fetched fresh via the poll.
- **Shared scheme rule:** bare `host:port` (local dev) → plaintext (`http`/`ws`); hostname without a port (hosted, behind TLS) → secure (`https`/`wss`). Centralized in a new `client/src/main/serverScheme.js`, replacing the two inline copies of this rule in `index.js` and `wsClient.js`.
- Follow existing patterns: single-purpose main-process modules wired up by `index.js`; pure logic colocated with a `node:test` file; thin `ipcRenderer.invoke`/`contextBridge` preload wrappers; injectable-dependency factories for anything HTTP/WS-testable (matches `createAuthGate` in `gateway.js`).

---

### Task 1: Shared `serverScheme.js` helper (TDD)

**Files:**
- Create: `client/src/main/serverScheme.js`
- Test: `client/src/main/serverScheme.test.js`
- Modify: `client/src/main/index.js` (the `open-login` IPC handler)
- Modify: `client/src/main/wsClient.js` (the `connect()` function)
- Modify: `client/package.json` (test script)

**Interfaces:**
- Produces: `schemeFor(serverAddress: string, { secure: string, insecure: string }) -> string`

- [ ] **Step 1: Write the failing tests** — create `client/src/main/serverScheme.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemeFor } from './serverScheme.js';

test('returns the insecure scheme for a bare host:port (local dev)', () => {
  assert.equal(schemeFor('localhost:3000', { secure: 'https', insecure: 'http' }), 'http');
  assert.equal(schemeFor('127.0.0.1:5000', { secure: 'https', insecure: 'http' }), 'http');
});

test('returns the secure scheme for a hosted hostname (no port)', () => {
  assert.equal(schemeFor('echo.example.com', { secure: 'https', insecure: 'http' }), 'https');
});

test('works for the ws/wss pair too', () => {
  assert.equal(schemeFor('localhost:3000', { secure: 'wss', insecure: 'ws' }), 'ws');
  assert.equal(schemeFor('echo.example.com', { secure: 'wss', insecure: 'ws' }), 'wss');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd client && node --test src/main/serverScheme.test.js`
Expected: FAIL — `Cannot find module './serverScheme.js'`

- [ ] **Step 3: Implement** — create `client/src/main/serverScheme.js`:

```js
// Bare host:port (local dev) → plaintext; hostname without a port (hosted,
// behind TLS) → secure. Shared by openLogin (index.js), wsClient.js, and
// profileClient.js so the rule exists in exactly one place.
export function schemeFor(serverAddress, { secure, insecure }) {
  return serverAddress.includes('localhost') || /:\d+$/.test(serverAddress) ? insecure : secure;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd client && node --test src/main/serverScheme.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Adopt it in `index.js`** — in `client/src/main/index.js`, add the import near the top:

```js
import { schemeFor } from './serverScheme.js';
```

Replace the `open-login` handler body:

```js
  ipcMain.handle('open-login', (_event, serverAddress) => {
    const scheme = schemeFor(serverAddress, { secure: 'https', insecure: 'http' });
    shell.openExternal(`${scheme}://${serverAddress}/auth/login`);
  });
```

- [ ] **Step 6: Adopt it in `wsClient.js`** — in `client/src/main/wsClient.js`, add the import near the top:

```js
import { schemeFor } from './serverScheme.js';
```

Replace the scheme line inside `connect()`:

```js
    const scheme = schemeFor(serverAddress, { secure: 'wss', insecure: 'ws' });
    socket = new WebSocket(`${scheme}://${serverAddress}/`);
```

- [ ] **Step 7: Register the new test file** — in `client/package.json`, add `src/main/serverScheme.test.js` to the `test` script's file list:

```json
    "test": "node --test src/main/protocolUrl.test.js src/main/backoff.test.js src/main/wsClient.test.js src/main/serverScheme.test.js src/renderer/src/resolveAppearance.test.js"
```

- [ ] **Step 8: Run the full client test suite to confirm nothing broke**

Run: `cd client && npm test`
Expected: PASS (all files, including `wsClient.test.js`'s existing scheme-dependent tests using `localhost:<port>`)

- [ ] **Step 9: Commit**

```bash
git add client/src/main/serverScheme.js client/src/main/serverScheme.test.js client/src/main/index.js client/src/main/wsClient.js client/package.json
git commit -m "refactor(client): extract shared http/ws scheme rule into serverScheme.js"
```

---

### Task 2: `bot.js` — presence intent + `getUserProfile`

**Files:**
- Modify: `bot.js`

**Interfaces:**
- Produces: `getUserProfile(userId: string) -> { username: string, avatarURL: string, discordStatus: 'online'|'idle'|'dnd'|'offline', inTrackedChannel: boolean } | null`

- [ ] **Step 1: Add the `GuildPresences` intent** — in `bot.js`, replace the `client` construction:

```js
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
});
```

- [ ] **Step 2: Warm the member/presence cache on ready** — replace the `ClientReady` handler:

```js
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  // member.presence is only populated for cached members once GuildPresences
  // is granted — a one-off REST guild.members.fetch(userId) lookup does not
  // include presence data, so the whole guild is fetched once up front here.
  const guild = readyClient.guilds.cache.get(DISCORD_SERVER_ID);
  if (guild) await guild.members.fetch();
});
```

- [ ] **Step 3: Add `getUserProfile`** — directly below `getRoster`, add:

```js
export function getUserProfile(userId) {
  const guild = client.guilds.cache.get(DISCORD_SERVER_ID);
  const member = guild?.members.cache.get(userId);
  if (!member) return null;
  return {
    username: member.displayName,
    avatarURL: member.displayAvatarURL({ extension: 'png', size: 128 }),
    discordStatus: member.presence?.status ?? 'offline',
    inTrackedChannel: isUserInTrackedChannel(userId),
  };
}
```

- [ ] **Step 4: Verify existing tests still pass** — `gateway.js` imports from `bot.js`, so `gateway.test.js` transitively loads this module.

Run: `node --test auth.test.js gateway.test.js`
Expected: PASS (no assertions touch `bot.js` directly; module-load-time behavior — constructing `new Client(...)` — is unaffected by these changes)

- [ ] **Step 5: Manual prerequisite reminder (not a code step)**

Before `discordStatus` will ever report anything but `'offline'`, enable "Presence Intent" for this bot application in the Discord Developer Portal → your application → Bot tab → Privileged Gateway Intents. This is a one-time manual toggle, not something committed to the repo.

- [ ] **Step 6: Commit**

```bash
git add bot.js
git commit -m "feat(bot): add GuildPresences intent and getUserProfile"
```

---

### Task 3: `gateway.js` — `GET /api/me` endpoint (TDD)

**Files:**
- Modify: `gateway.js`
- Test: `gateway.test.js`

**Interfaces:**
- Consumes: `verifySessionToken` (from `auth.js`, already imported), `getUserProfile` (Task 2)
- Produces: `createMeHandler({ verifyToken, getProfile }) -> (req, res) => void`; wired as `GET /api/me` returning `{ userId, username, avatarURL, discordStatus, inTrackedChannel }` (200), `{ error: 'unauthorized' }` (401, missing/invalid token), or `{ error: 'not found' }` (404, no matching guild member)

- [ ] **Step 1: Write the failing tests** — append to `gateway.test.js`:

```js
import http from 'node:http';
import { createMeHandler } from './gateway.js';

function startTestHttpServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

test('GET /api/me returns 200 with profile JSON for a valid token', async () => {
  const handler = createMeHandler({
    verifyToken: (token) => (token === 'good-token' ? 'user-1' : null),
    getProfile: (userId) =>
      userId === 'user-1'
        ? { username: 'Alice', avatarURL: 'https://x/a.png', discordStatus: 'online', inTrackedChannel: true }
        : null,
  });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/me`, { headers: { Authorization: 'Bearer good-token' } });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.userId, 'user-1');
  assert.equal(body.username, 'Alice');
  assert.equal(body.discordStatus, 'online');
  assert.equal(body.inTrackedChannel, true);
  server.close();
});

test('GET /api/me returns 401 with no Authorization header', async () => {
  const handler = createMeHandler({ verifyToken: () => 'user-1', getProfile: () => ({}) });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/me`);
  assert.equal(res.status, 401);
  server.close();
});

test('GET /api/me returns 401 for an invalid token', async () => {
  const handler = createMeHandler({ verifyToken: () => null, getProfile: () => ({}) });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/me`, { headers: { Authorization: 'Bearer bad-token' } });
  assert.equal(res.status, 401);
  server.close();
});

test('GET /api/me returns 404 when the user has no matching guild member', async () => {
  const handler = createMeHandler({ verifyToken: () => 'user-1', getProfile: () => null });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/me`, { headers: { Authorization: 'Bearer tok' } });
  assert.equal(res.status, 404);
  server.close();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test gateway.test.js`
Expected: FAIL — `createMeHandler is not a function` (or not exported)

- [ ] **Step 3: Implement `createMeHandler` and wire the route** — in `gateway.js`, add near `createAuthGate`:

```js
export function createMeHandler({ verifyToken, getProfile }) {
  return function handleMe(req, res) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
    const userId = token ? verifyToken(token) : null;
    if (!userId) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const profile = getProfile(userId);
    if (!profile) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ userId, ...profile }));
  };
}
```

Update the top import to pull in `getUserProfile`:

```js
import { isUserInTrackedChannel, getRoster, getUserProfile } from './bot.js';
```

Add the handler instance and route, right before the `httpServer` definition:

```js
const handleMe = createMeHandler({ verifyToken: verifySessionToken, getProfile: getUserProfile });

export const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/auth/login') return handleAuthLogin(req, res);
  if (url.pathname === '/auth/callback') return handleAuthCallback(req, res);
  if (url.pathname === '/api/me') return handleMe(req, res);
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found — use the discord-echo Electron client to view captions.');
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test gateway.test.js`
Expected: PASS (all tests, including the 4 new ones)

- [ ] **Step 5: Run the full root test suite**

Run: `npm test`
Expected: PASS (`auth.test.js` + `gateway.test.js`)

- [ ] **Step 6: Commit**

```bash
git add gateway.js gateway.test.js
git commit -m "feat(gateway): add GET /api/me profile endpoint"
```

---

### Task 4: Client `profileClient.js`

**Files:**
- Create: `client/src/main/profileClient.js`

**Interfaces:**
- Consumes: `schemeFor` (Task 1)
- Produces: `fetchProfile({ serverAddress: string, token: string }) -> Promise<{ userId, username, avatarURL, discordStatus, inTrackedChannel } | null>`; throws `AuthError` on a 401 response; a rejected promise (network failure — server unreachable) propagates uncaught, distinct from both of those.
- Produces: `class AuthError extends Error {}`

- [ ] **Step 1: Implement** — create `client/src/main/profileClient.js`:

```js
import { schemeFor } from './serverScheme.js';

export class AuthError extends Error {}

export async function fetchProfile({ serverAddress, token }) {
  const scheme = schemeFor(serverAddress, { secure: 'https', insecure: 'http' });
  const res = await fetch(`${scheme}://${serverAddress}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new AuthError('session expired');
  if (!res.ok) return null; // 404 (not in guild) or a non-auth server error
  return res.json();
}
```

This module has no dedicated unit test — matches this project's existing precedent for thin main-process HTTP/IPC glue (e.g. `index.js` itself has none); it's exercised via Task 9's manual verification.

- [ ] **Step 2: Sanity-check nothing broke**

Run: `cd client && npm test`
Expected: PASS (this file isn't imported by any test yet, so this just confirms no syntax error broke module resolution elsewhere)

- [ ] **Step 3: Commit**

```bash
git add client/src/main/profileClient.js
git commit -m "feat(client): profileClient.fetchProfile for the /api/me endpoint"
```

---

### Task 5: `index.js` — profile polling + IPC

**Files:**
- Modify: `client/src/main/index.js`

**Interfaces:**
- Consumes: `fetchProfile`, `AuthError` (Task 4)
- Produces: IPC handler `get-profile` (pull) and pushed event `profile`, both carrying the shape `{ reachable: boolean, profile: { userId, username, avatarURL, discordStatus, inTrackedChannel } | null }`. A `get-profile` call can also resolve to `null` in the rare case it triggers an auth failure — see Step 2.

- [ ] **Step 1: Add the import and poll-state constant** — near the top of `client/src/main/index.js`, alongside the existing imports:

```js
import { fetchProfile, AuthError } from './profileClient.js';
```

Add near the other module-level `let`s (next to `let wsClient = null;`):

```js
const PROFILE_POLL_INTERVAL_MS = 15000;
let profilePollTimer = null;
```

- [ ] **Step 2: Add the polling functions** — directly below the existing `startWsClient` function, add:

```js
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
  profilePollTimer = setInterval(async () => {
    const result = await pollProfileOnce();
    if (result && launcherWindow) launcherWindow.webContents.send('profile', result);
  }, PROFILE_POLL_INTERVAL_MS);
}

function stopProfilePolling() {
  if (profilePollTimer) {
    clearInterval(profilePollTimer);
    profilePollTimer = null;
  }
}
```

- [ ] **Step 3: Start/stop polling at the right lifecycle points**

In `logout()`, add `stopProfilePolling();` as the first line of the function body:

```js
function logout() {
  stopProfilePolling();
  wsClient?.close();
  ...
```

In `deliverAuthToken`, start polling once the token is stored:

```js
function deliverAuthToken(token, userId) {
  store.set('sessionToken', token);
  if (userId) store.set('loggedInUserId', userId);
  startProfilePolling();
  if (launcherWindow) {
```

In `app.whenReady().then(...)`, start polling at launch if already logged in:

```js
  app.whenReady().then(() => {
    reconcileFriendProfiles(store);
    registerIpcHandlers();
    createLauncherWindow();
    if (store.get('sessionToken')) startProfilePolling();
    if (deferredOpenUrl) handleDeepLink(deferredOpenUrl);
  });
```

In `createLauncherWindow`'s `closed` handler, stop polling when the launcher closes:

```js
  launcherWindow.on('closed', () => {
    launcherWindow = null;
    stopProfilePolling();
  });
```

- [ ] **Step 4: Add the `get-profile` IPC handler** — inside `registerIpcHandlers`, directly below the existing `get-state-snapshot` handler:

```js
  ipcMain.handle('get-profile', () => pollProfileOnce());
```

- [ ] **Step 5: Sanity-check**

Run: `cd client && npm test`
Expected: PASS (no existing test imports `index.js`; this confirms no syntax errors)

- [ ] **Step 6: Commit**

```bash
git add client/src/main/index.js
git commit -m "feat(client): poll /api/me and expose get-profile/profile IPC"
```

---

### Task 6: Preload bridge

**Files:**
- Modify: `client/src/preload/index.cjs`

**Interfaces:**
- Consumes: `get-profile`/`profile` IPC channels (Task 5)
- Produces: `window.api.getProfile() -> Promise<{reachable, profile} | null>`, `window.api.onProfile(callback) -> unsubscribe`

- [ ] **Step 1: Add the two bridge methods** — in `client/src/preload/index.cjs`, add alongside the other `get*`/`on*` entries in the `contextBridge.exposeInMainWorld('api', {...})` object:

```js
  getProfile: () => ipcRenderer.invoke('get-profile'),
  onProfile: subscribe('profile', (callback) => (_e, result) => callback(result)),
```

- [ ] **Step 2: Sanity-check**

Run: `cd client && npm test`
Expected: PASS (preload has no direct test coverage; this confirms no syntax error)

- [ ] **Step 3: Commit**

```bash
git add client/src/preload/index.cjs
git commit -m "feat(client): expose getProfile/onProfile on the preload bridge"
```

---

### Task 7: `ProfileHeader.jsx` component

**Files:**
- Create: `client/src/renderer/src/ProfileHeader.jsx`
- Modify: `client/src/renderer/src/assets/app.css`

**Interfaces:**
- Consumes: `profile: { userId, username, avatarURL, discordStatus, inTrackedChannel } | null`, `reachable: boolean` props (matches the shape produced by Task 5/6)
- Produces: `export default function ProfileHeader({ profile, reachable })`, rendered by `LauncherView` (Task 8)

- [ ] **Step 1: Implement the component** — create `client/src/renderer/src/ProfileHeader.jsx`:

```jsx
const STATUS_COLORS = {
  online: '#23a55a',
  idle: '#f0b232',
  dnd: '#f23f43',
  offline: '#80848e',
};

export default function ProfileHeader({ profile, reachable }) {
  if (!reachable) {
    return (
      <div className="profile-header">
        <p className="profile-header-status">Server unreachable</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="profile-header">
        <p className="profile-header-status">Not found in the Discord server</p>
      </div>
    );
  }

  const dotColor = STATUS_COLORS[profile.discordStatus] ?? STATUS_COLORS.offline;

  return (
    <div className="profile-header">
      <img className="profile-header-avatar" src={profile.avatarURL} alt="" />
      <div className="profile-header-info">
        <div className="profile-header-name">
          <span className="status-dot" style={{ background: dotColor }} />
          {profile.username}
        </div>
        <p className="profile-header-id">{profile.userId}</p>
        <p className="profile-header-badge">
          {profile.inTrackedChannel ? 'In voice channel' : 'Not in voice channel'}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the CSS** — append to `client/src/renderer/src/assets/app.css`:

```css
/* --- profile header (launcher, logged in) --- */
.profile-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  background: #26272d;
  border-radius: 8px;
}

.profile-header-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  flex: none;
}

.profile-header-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.profile-header-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 13px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.profile-header-id {
  margin: 0;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 11px;
  opacity: 0.6;
}

.profile-header-badge {
  margin: 0;
  font-size: 11px;
  opacity: 0.7;
}

.profile-header-status {
  margin: 0;
  font-size: 12px;
  opacity: 0.7;
}
```

- [ ] **Step 3: Sanity-check**

Run: `cd client && npm test`
Expected: PASS (no test imports this component; confirms no syntax error)

- [ ] **Step 4: Commit**

```bash
git add client/src/renderer/src/ProfileHeader.jsx client/src/renderer/src/assets/app.css
git commit -m "feat(client): add ProfileHeader component"
```

---

### Task 8: `LauncherView.jsx` — login button & profile header wiring

**Files:**
- Modify: `client/src/renderer/src/LauncherView.jsx`

**Interfaces:**
- Consumes: `ProfileHeader` (Task 7), `window.api.getProfile`/`onProfile` (Task 6), existing `window.api.openLogin`/`getSettings`/`startChatWindow`/`logout`

- [ ] **Step 1: Replace the whole file** — `client/src/renderer/src/LauncherView.jsx`:

```jsx
import { useEffect, useState } from 'react';
import TitleBar from './TitleBar';
import SettingsView from './settings/SettingsView';
import ProfileHeader from './ProfileHeader';

export default function LauncherView() {
  const [settings, setSettings] = useState(null);
  const [page, setPage] = useState('main');
  const [loginError, setLoginError] = useState(null);
  const [profileState, setProfileState] = useState({ reachable: true, profile: null });

  useEffect(() => {
    window.api.getSettings().then(setSettings);
    window.api.getProfile().then((result) => {
      if (result) setProfileState(result);
    });
    const unsubscribes = [
      window.api.onAuthToken(() => {
        window.api.getSettings().then(setSettings);
        setLoginError(null);
      }),
      window.api.onAuthError((reason) => {
        if (reason === 'session_expired') {
          setLoginError(null);
          window.api.getSettings().then(setSettings);
          return;
        }
        setLoginError(reason === 'access_denied' ? 'Login was cancelled.' : 'Login failed — please try again.');
      }),
      window.api.onOpenSettings(() => setPage('settings')),
      window.api.onProfile((result) => setProfileState(result)),
    ];
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, []);

  if (!settings) return null;

  function handleLogin() {
    setLoginError(null);
    window.api.openLogin(settings.serverAddress).catch(() =>
      setLoginError('Could not reach the login page — check the server address in Settings and try again.'),
    );
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
        <SettingsView settings={settings} onSettingsChange={handleSettingsChange} onBack={() => setPage('main')} />
      ) : (
        <div className="launcher-content">
          {loginError && (
            <div role="alert">
              <p>{loginError}</p>
              <button onClick={handleLogin}>Retry</button>
            </div>
          )}
          {settings.hasSessionToken ? (
            <>
              <ProfileHeader profile={profileState.profile} reachable={profileState.reachable} />
              <button onClick={() => setPage('settings')}>Settings</button>
              <button onClick={() => window.api.startChatWindow()}>Start Chat Window</button>
              <button onClick={() => window.api.logout().then(() => window.api.getSettings().then(setSettings))}>
                Log out
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setPage('settings')}>Settings</button>
              <button onClick={handleLogin}>Login to Discord</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Sanity-check**

Run: `cd client && npm test`
Expected: PASS (no test imports this component; confirms no syntax error)

- [ ] **Step 3: Commit**

```bash
git add client/src/renderer/src/LauncherView.jsx
git commit -m "feat(client): login button when logged out, profile header when logged in"
```

---

### Task 9: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm the Presence Intent prerequisite**

Verify "Presence Intent" is toggled on for the bot application in the Discord Developer Portal (Bot tab → Privileged Gateway Intents). If not, toggle it now — the bot process needs a restart to pick it up.

- [ ] **Step 2: Launch the app and log in**

Use the `run` skill to start the server (`npm start` at repo root) and the Electron client (`cd client && npm run dev`). In the launcher window while logged out, confirm only a "Login to Discord" button and a "Settings" button are visible (no "Start Chat Window"). Click "Login to Discord", complete the Discord OAuth flow.

- [ ] **Step 3: Confirm the profile header renders**

After login, confirm the launcher shows: your Discord avatar, username, your numeric user_id, a status dot, and "In voice channel" / "Not in voice channel".

- [ ] **Step 4: Confirm the tracked-channel badge updates**

Join the voice channel the bot is tracking (run `/captions start` in Discord first if no session is active) and confirm the badge flips to "In voice channel" within one poll tick (up to 15s). Leave the channel and confirm it flips back.

- [ ] **Step 5: Confirm the presence dot reflects real status**

Change your Discord status (e.g. to Idle or Do Not Disturb) and confirm the dot color updates within one poll tick.

- [ ] **Step 6: Confirm "Unreachable" state**

Stop the server process (`Ctrl+C` on `npm start`) and confirm the profile header switches to "Server unreachable" within one poll tick. Restart the server and confirm it recovers.

- [ ] **Step 7: Confirm logout reverts the view**

Click "Log out" and confirm the launcher reverts to showing only "Login to Discord" (no stale profile header).
