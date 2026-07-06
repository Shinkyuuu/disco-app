# Multi-Guild Session Routing & Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the single shared Disco bot run independent, isolated caption sessions across many Discord guilds at once, with viewers continuously authorized against their *live* voice channel rather than a one-time check.

**Architecture:** A new `sessionRegistry.js` module replaces `bot.js`'s single global `trackedChannel`/`roster` state with a `Map<guildId, session>`. `gateway.js`'s broadcast becomes guild-scoped and re-resolves each connected client's live voice channel (via `bot.js`'s `getLiveSessionForUser`) on every message, so authorization is a continuously-enforced invariant instead of a connect-time gate. `bot.js` drops its hardcoded `DISCORD_SERVER_ID` and registers slash commands globally so any inviting guild can use `/disco join`.

**Tech Stack:** Node.js, `discord.js`, `@discordjs/voice`, `ws`, `node:test` + `node:assert/strict` (existing stack, no new dependencies).

## Global Constraints

- At most one active session per guild at a time (`/disco join` in a guild with an existing session errors instead of starting a second one). Multi-channel-per-guild is explicitly out of scope.
- Global concurrency cap: `MAX_ACTIVE_SESSIONS` env var, default `5`, checked across all guilds combined before starting a new session.
- No client code changes - new `guildId`/`channelId` message fields are purely additive; existing handlers in `wsClient.js` already destructure only the fields they use.
- `sessionRegistry.js` must have no `discord.js` dependency (pure in-memory state), so it stays swappable for a future distributed backend.
- Follow existing test conventions exactly: `node:test` + `node:assert/strict`, dependency-injected factories (`createX({ ... })`) for anything unit-tested, real `ws`/`http` servers bound to port 0 for integration-style tests (see `gateway.test.js`).
- `bot.js` has no unit tests today (thin `discord.js` wrapper) - that precedent continues; it's verified manually in Task 3.

---

### Task 1: `sessionRegistry.js` - session bookkeeping module

**Files:**
- Create: `sessionRegistry.js`
- Test: `sessionRegistry.test.js`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (used by Task 2):
  - `createSession(guildId: string, { channelId: string, ownerId: string, voiceStateListener: Function|null }): { channelId, ownerId, roster: [], voiceStateListener }`
  - `endSession(guildId: string): session|undefined` (the removed entry, or `undefined` if none existed)
  - `getSession(guildId: string): { channelId, ownerId, roster, voiceStateListener }|undefined`
  - `setRoster(guildId: string, roster: Array): void` (no-op if no session exists for `guildId`)
  - `activeSessionCount(): number`

- [ ] **Step 1: Write the failing tests**

Create `sessionRegistry.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, endSession, getSession, setRoster, activeSessionCount } from './sessionRegistry.js';

test('createSession stores a session retrievable by guildId', () => {
  createSession('guild-a', { channelId: 'chan-1', ownerId: 'user-1', voiceStateListener: null });
  const session = getSession('guild-a');
  assert.equal(session.channelId, 'chan-1');
  assert.equal(session.ownerId, 'user-1');
  assert.deepEqual(session.roster, []);
  endSession('guild-a');
});

test('getSession returns undefined for a guild with no active session', () => {
  assert.equal(getSession('guild-nonexistent'), undefined);
});

test('endSession removes the session and returns the removed entry', () => {
  createSession('guild-b', { channelId: 'chan-2', ownerId: 'user-2', voiceStateListener: null });
  const removed = endSession('guild-b');
  assert.equal(removed.channelId, 'chan-2');
  assert.equal(getSession('guild-b'), undefined);
});

test('endSession on a guild with no session returns undefined', () => {
  assert.equal(endSession('guild-never-existed'), undefined);
});

test('setRoster updates the roster for an existing session', () => {
  createSession('guild-c', { channelId: 'chan-3', ownerId: 'user-3', voiceStateListener: null });
  setRoster('guild-c', [{ speakerId: 'user-3', username: 'Bob' }]);
  assert.deepEqual(getSession('guild-c').roster, [{ speakerId: 'user-3', username: 'Bob' }]);
  endSession('guild-c');
});

test('setRoster is a no-op for a guild with no session', () => {
  setRoster('guild-does-not-exist', [{ speakerId: 'x' }]);
  assert.equal(getSession('guild-does-not-exist'), undefined);
});

test('activeSessionCount reflects the number of currently active sessions', () => {
  const before = activeSessionCount();
  createSession('guild-d', { channelId: 'chan-4', ownerId: 'user-4', voiceStateListener: null });
  createSession('guild-e', { channelId: 'chan-5', ownerId: 'user-5', voiceStateListener: null });
  assert.equal(activeSessionCount(), before + 2);
  endSession('guild-d');
  endSession('guild-e');
  assert.equal(activeSessionCount(), before);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test sessionRegistry.test.js`
Expected: FAIL - `Cannot find module './sessionRegistry.js'`

- [ ] **Step 3: Implement `sessionRegistry.js`**

```js
const sessions = new Map(); // guildId -> { channelId, ownerId, roster, voiceStateListener }

export function createSession(guildId, { channelId, ownerId, voiceStateListener }) {
  const session = { channelId, ownerId, roster: [], voiceStateListener };
  sessions.set(guildId, session);
  return session;
}

export function endSession(guildId) {
  const session = sessions.get(guildId);
  sessions.delete(guildId);
  return session;
}

export function getSession(guildId) {
  return sessions.get(guildId);
}

export function setRoster(guildId, roster) {
  const session = sessions.get(guildId);
  if (session) session.roster = roster;
}

export function activeSessionCount() {
  return sessions.size;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test sessionRegistry.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add sessionRegistry.js sessionRegistry.test.js
git commit -m "feat: add sessionRegistry module for per-guild session state"
```

---

### Task 2: `gateway.js` + `bot.js` - guild-scoped session routing and multi-guild bot behavior

`gateway.js` and `bot.js` already import from each other today (`bot.js` calls
`broadcast`/`PORT_NUMBER` from `gateway.js`; `gateway.js` calls `isUserInTrackedChannel`/
`getRoster`/`getUserProfile` from `bot.js`) - a live circular ESM import that works because
each side only calls the other's exports from inside function bodies, never at module
top-level. This task renames/reshapes several of those exports on both sides at once
(`broadcast` -> `broadcastToSession`, `isUserInTrackedChannel`/`getRoster` -> a single
`getLiveSessionForUser`), so the two files must be rewritten together: if only one side
were updated, the other side's import of a since-renamed export would fail at module load
(Node's ESM loader checks that every named import actually exists in the target module,
even for bindings that are never called). Both files are written in this one task, and
the automated test suite is run once at the end, after both are in place.

**Files:**
- Modify: `gateway.js` (full rewrite)
- Modify: `gateway.test.js` (full rewrite)
- Modify: `bot.js` (full rewrite)
- Modify: `.env.example`

**Interfaces:**
- Consumes (from Task 1): `getSession(guildId)`, `createSession`, `endSession`, `setRoster`, `activeSessionCount` from `sessionRegistry.js`.
- `gateway.js` produces (consumed by `bot.js` in this same task):
  - `createAuthGate({ verifyToken, getLiveSession, getRosterSnapshot, clients, timeoutMs })` - same shape as today's factory, but `isAuthorized` is replaced by `getLiveSession(userId): { guildId, channelId }|null`, and it now requires an externally-owned `clients: Map<ws, userId>` instead of managing a private `Set`.
  - `createBroadcaster({ getLiveSession, clients })` returning `broadcastToSession(guildId: string, payload: object): void` - delivers `JSON.stringify({ ...payload, guildId })` only to clients in `clients` whose `getLiveSession(userId)?.guildId === guildId` and whose socket `readyState === WebSocket.OPEN`.
  - `broadcastToSession(guildId, payload)` - the real, wired-up instance `bot.js` imports and calls.
  - `createMeHandler` - unchanged from today.
- `bot.js` produces (consumed by `gateway.js`'s real wiring in this same task):
  - `getLiveSessionForUser(userId): { guildId, channelId }|null`.
  - `getUserProfile(userId): { username, avatarURL, discordStatus, inTrackedChannel }|null`.

- [ ] **Step 1: Write the failing/updated tests**

Replace the full contents of `gateway.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createAuthGate, createMeHandler, createBroadcaster } from './gateway.js';

function startTestServer(gateOptions) {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const { port } = wss.address();
      wss.on('connection', createAuthGate(gateOptions));
      resolve({ wss, port });
    });
  });
}

test('accepts a connection with a valid token for an authorized user, and sends roster scoped to their live guild', async () => {
  const { wss, port } = await startTestServer({
    verifyToken: (token) => (token === 'good-token' ? 'user-1' : null),
    getLiveSession: (userId) => (userId === 'user-1' ? { guildId: 'guild-1', channelId: 'chan-1' } : null),
    getRosterSnapshot: (guildId) =>
      guildId === 'guild-1' ? [{ speakerId: 'user-1', username: 'Alice', avatarURL: 'https://x/a.png' }] : [],
    clients: new Map(),
    timeoutMs: 1000,
  });
  const ws = new WebSocket(`ws://localhost:${port}`);
  await new Promise((resolve) => ws.once('open', resolve));
  const firstMessage = new Promise((resolve) => ws.once('message', (data) => resolve(JSON.parse(data.toString()))));
  ws.send(JSON.stringify({ type: 'auth', token: 'good-token' }));
  const roster = await firstMessage;
  assert.equal(roster.type, 'roster');
  assert.equal(roster.guildId, 'guild-1');
  assert.equal(roster.members[0].username, 'Alice');
  assert.equal(ws.readyState, WebSocket.OPEN);
  ws.close();
  wss.close();
});

test('closes with 4003 for an invalid token', async () => {
  const { wss, port } = await startTestServer({
    verifyToken: () => null,
    getLiveSession: () => ({ guildId: 'guild-1', channelId: 'chan-1' }),
    getRosterSnapshot: () => [],
    clients: new Map(),
    timeoutMs: 1000,
  });
  const ws = new WebSocket(`ws://localhost:${port}`);
  await new Promise((resolve) => ws.once('open', resolve));
  const closePromise = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
  ws.send(JSON.stringify({ type: 'auth', token: 'bad-token' }));
  assert.equal(await closePromise, 4003);
  wss.close();
});

test('closes with 4001 when the user has no live session in an active channel', async () => {
  const { wss, port } = await startTestServer({
    verifyToken: () => 'user-1',
    getLiveSession: () => null,
    getRosterSnapshot: () => [],
    clients: new Map(),
    timeoutMs: 1000,
  });
  const ws = new WebSocket(`ws://localhost:${port}`);
  await new Promise((resolve) => ws.once('open', resolve));
  const closePromise = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
  ws.send(JSON.stringify({ type: 'auth', token: 'irrelevant' }));
  assert.equal(await closePromise, 4001);
  wss.close();
});

test('closes with 4002 for a malformed first message', async () => {
  const { wss, port } = await startTestServer({
    verifyToken: () => 'user-1',
    getLiveSession: () => ({ guildId: 'guild-1', channelId: 'chan-1' }),
    getRosterSnapshot: () => [],
    clients: new Map(),
    timeoutMs: 1000,
  });
  const ws = new WebSocket(`ws://localhost:${port}`);
  await new Promise((resolve) => ws.once('open', resolve));
  const closePromise = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
  ws.send('not json');
  assert.equal(await closePromise, 4002);
  wss.close();
});

test('closes with 4008 if no auth message arrives before the timeout', async () => {
  const { wss, port } = await startTestServer({
    verifyToken: () => 'user-1',
    getLiveSession: () => ({ guildId: 'guild-1', channelId: 'chan-1' }),
    getRosterSnapshot: () => [],
    clients: new Map(),
    timeoutMs: 50,
  });
  const ws = new WebSocket(`ws://localhost:${port}`);
  const closePromise = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
  assert.equal(await closePromise, 4008);
  wss.close();
});

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

test('broadcastToSession delivers only to clients whose live session matches the target guild', () => {
  const sent = [];
  const wsA = { readyState: WebSocket.OPEN, send: (msg) => sent.push(['A', JSON.parse(msg)]) };
  const wsB = { readyState: WebSocket.OPEN, send: (msg) => sent.push(['B', JSON.parse(msg)]) };
  const clients = new Map([[wsA, 'user-a'], [wsB, 'user-b']]);
  const getLiveSession = (userId) => (userId === 'user-a' ? { guildId: 'guild-1' } : { guildId: 'guild-2' });
  const broadcastToSession = createBroadcaster({ getLiveSession, clients });

  broadcastToSession('guild-1', { type: 'transcript', text: 'hello' });

  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'A');
  assert.equal(sent[0][1].guildId, 'guild-1');
  assert.equal(sent[0][1].text, 'hello');
});

test('broadcastToSession skips a client with no live session', () => {
  const sent = [];
  const wsA = { readyState: WebSocket.OPEN, send: (msg) => sent.push(msg) };
  const clients = new Map([[wsA, 'user-a']]);
  const broadcastToSession = createBroadcaster({ getLiveSession: () => null, clients });

  broadcastToSession('guild-1', { type: 'roster', members: [] });

  assert.equal(sent.length, 0);
});

test('broadcastToSession skips a client whose socket is not open', () => {
  const sent = [];
  const wsA = { readyState: WebSocket.CLOSING, send: (msg) => sent.push(msg) };
  const clients = new Map([[wsA, 'user-a']]);
  const broadcastToSession = createBroadcaster({
    getLiveSession: () => ({ guildId: 'guild-1' }),
    clients,
  });

  broadcastToSession('guild-1', { type: 'roster', members: [] });

  assert.equal(sent.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test gateway.test.js`
Expected: FAIL - `createBroadcaster` is not exported yet; existing tests fail on the changed `getLiveSession`/`clients` parameter shape.

- [ ] **Step 3: Write `gateway.js`**

Replace the full file contents:

```js
import 'dotenv/config';
import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { handleAuthLogin, handleAuthCallback, verifySessionToken } from './auth.js';
import { getLiveSessionForUser, getUserProfile } from './bot.js';
import { getSession } from './sessionRegistry.js';

const { PORT } = process.env;
export const PORT_NUMBER = PORT || 3000;

export const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/auth/login') return handleAuthLogin(req, res);
  if (url.pathname === '/auth/callback') return handleAuthCallback(req, res);
  if (url.pathname === '/api/me') return handleMe(req, res);
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found - use the Disco Electron client to view captions.');
});

const gatewayClients = new Map(); // ws -> userId
const wss = new WebSocketServer({ server: httpServer });

const AUTH_TIMEOUT_MS = 5000;

export function createAuthGate({ verifyToken, getLiveSession, getRosterSnapshot, clients, timeoutMs = AUTH_TIMEOUT_MS }) {
  return function handleConnection(ws) {
    const timer = setTimeout(() => ws.close(4008, 'auth timeout'), timeoutMs);
    // Without this, a client that opens a socket and disconnects without ever sending
    // anything leaves the timer pending for up to timeoutMs, calling ws.close() on an
    // already-closed socket (harmless, but a dangling reference worth not leaving around).
    ws.once('close', () => clearTimeout(timer));

    ws.once('message', (data) => {
      clearTimeout(timer);
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        ws.close(4002, 'invalid auth payload');
        return;
      }
      if (msg.type !== 'auth' || typeof msg.token !== 'string') {
        ws.close(4002, 'invalid auth payload');
        return;
      }
      const userId = verifyToken(msg.token);
      if (!userId) {
        ws.close(4003, 'invalid or expired token');
        return;
      }
      const liveSession = getLiveSession(userId);
      if (!liveSession) {
        ws.close(4001, 'not in voice channel');
        return;
      }
      clients.set(ws, userId);
      ws.on('close', () => clients.delete(ws));
      ws.send(JSON.stringify({
        type: 'roster',
        guildId: liveSession.guildId,
        channelId: liveSession.channelId,
        members: getRosterSnapshot(liveSession.guildId),
      }));
    });
  };
}

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

const handleMe = createMeHandler({ verifyToken: verifySessionToken, getProfile: getUserProfile });

export function createBroadcaster({ getLiveSession, clients }) {
  return function broadcastToSession(guildId, payload) {
    const message = JSON.stringify({ ...payload, guildId });
    for (const [ws, userId] of clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const liveSession = getLiveSession(userId);
      if (liveSession?.guildId === guildId) ws.send(message);
    }
  };
}

function getRosterSnapshot(guildId) {
  return getSession(guildId)?.roster ?? [];
}

wss.on('connection', createAuthGate({
  verifyToken: verifySessionToken,
  getLiveSession: getLiveSessionForUser,
  getRosterSnapshot,
  clients: gatewayClients,
}));

export const broadcastToSession = createBroadcaster({
  getLiveSession: getLiveSessionForUser,
  clients: gatewayClients,
});

export function startGateway() {
  httpServer.listen(PORT_NUMBER, () => {
    console.log(`Caption overlay available at http://localhost:${PORT_NUMBER}`);
  });
}
```

Do not run tests yet - `bot.js` still has its old content at this point (it imports
`broadcast` from `gateway.js`, which no longer exports that name), so the module graph
won't load successfully until Step 4 below rewrites `bot.js` too.

- [ ] **Step 4: Write `bot.js`**

Replace the full file contents:

```js
import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Events,
  ApplicationCommandOptionType,
} from 'discord.js';
import {
  joinVoiceChannel,
  getVoiceConnection,
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import prism from 'prism-media';
import WebSocket from 'ws';
import { broadcastToSession, PORT_NUMBER } from './gateway.js';
import { createSession, endSession, getSession, setRoster, activeSessionCount } from './sessionRegistry.js';

const { DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, DEEPGRAM_API_KEY } = process.env;
const MAX_ACTIVE_SESSIONS = Number(process.env.MAX_ACTIVE_SESSIONS) || 5;

const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=48000&channels=2&endpointing=300&model=nova-3';

const commands = [
  {
    name: 'disco',
    description: 'Manage live captions for this voice channel',
    options: [
      {
        name: 'join',
        description: 'Joins voice channel',
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: 'leave',
        description: 'Leaves voice channel',
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: 'ping',
        description: 'pong!',
        type: ApplicationCommandOptionType.Subcommand,
      },
    ],
  },
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

// member.presence is only populated for cached members once GuildPresences is granted,
// and a one-off REST guild.members.fetch(userId) lookup does not include presence data -
// so each guild's full member list is fetched once, the first time it's actually needed,
// rather than eagerly for every guild the bot happens to be invited to.
const fetchedGuilds = new Set();
async function ensureMembersFetched(guild) {
  if (fetchedGuilds.has(guild.id)) return;
  try {
    await guild.members.fetch();
    fetchedGuilds.add(guild.id);
  } catch (err) {
    console.error(`Failed to fetch members for guild ${guild.id}:`, err);
  }
}

async function resolveSpeaker(guildId, userId) {
  const guild = client.guilds.cache.get(guildId);
  const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId);
  return { username: member.displayName, avatarURL: member.displayAvatarURL({ extension: 'png', size: 128 }) };
}

// key: `${guildId}:${userId}` -> { opusStream, dgSocket } | null (reserved while resolving speaker)
const activeStreams = new Map();

// A Discord user can only be connected to one voice channel platform-wide at a time, so
// at most one guild will ever have a cached voice state for a given userId. This is the
// single source of truth both the gateway's connect-time auth gate and its per-broadcast
// filtering use to decide who is currently allowed to see a given guild's session.
export function getLiveSessionForUser(userId) {
  for (const guild of client.guilds.cache.values()) {
    const channelId = guild.voiceStates.cache.get(userId)?.channelId;
    if (channelId && getSession(guild.id)?.channelId === channelId) {
      return { guildId: guild.id, channelId };
    }
  }
  return null;
}

export function getUserProfile(userId) {
  const liveSession = getLiveSessionForUser(userId);
  const preferredGuild = liveSession ? client.guilds.cache.get(liveSession.guildId) : null;
  const guild = preferredGuild?.members.cache.has(userId)
    ? preferredGuild
    : client.guilds.cache.find((g) => g.members.cache.has(userId));
  const member = guild?.members.cache.get(userId);
  if (!member) return null;
  return {
    username: member.displayName,
    avatarURL: member.displayAvatarURL({ extension: 'png', size: 128 }),
    discordStatus: member.presence?.status ?? 'offline',
    inTrackedChannel: !!liveSession,
  };
}

function buildRoster(channel) {
  return channel.members
    .filter((member) => !member.user.bot)
    .map((member) => ({
      speakerId: member.id,
      username: member.displayName,
      avatarURL: member.displayAvatarURL({ extension: 'png', size: 128 }),
      // .mute/.deaf combine self- and server- states (either counts)
      isMuted: member.voice.mute ?? false,
      isDeafened: member.voice.deaf ?? false,
    }));
}

async function startTranscribing(guildId, channelId, connection, userId) {
  const key = `${guildId}:${userId}`;
  if (activeStreams.has(key)) return;
  activeStreams.set(key, null);

  const speaker = await resolveSpeaker(guildId, userId);

  // /disco leave may have run while the attribution lookup above was in flight.
  if (!activeStreams.has(key)) return;

  const opusStream = connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 1000 },
  });
  const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
  const pcmStream = opusStream.pipe(decoder);

  const dgSocket = new WebSocket(DEEPGRAM_URL, { headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` } });
  let dgOpen = false;
  let buffered = [];

  // Identity, not just key, so a stale pipeline's error/close can't delete a newer one's entry.
  const entry = { opusStream, dgSocket };

  dgSocket.on('open', () => {
    dgOpen = true;
    for (const chunk of buffered) dgSocket.send(chunk);
    buffered = [];
  });

  pcmStream.on('data', (chunk) => {
    if (dgOpen) dgSocket.send(chunk);
    else buffered.push(chunk);
  });

  dgSocket.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    const transcript = msg.channel?.alternatives?.[0]?.transcript;
    if (!transcript) return;
    console.log(`[${speaker.username}] ${msg.is_final ? 'final' : 'interim'}: ${transcript}`);
    broadcastToSession(guildId, {
      type: 'transcript',
      channelId,
      speakerId: userId,
      username: speaker.username,
      avatarURL: speaker.avatarURL,
      text: transcript,
      isFinal: msg.is_final,
    });
  });

  dgSocket.on('error', (err) => {
    console.error(`[${userId}] Deepgram error:`, err);
    if (activeStreams.get(key) === entry) activeStreams.delete(key);
  });
  dgSocket.on('close', () => {
    if (activeStreams.get(key) === entry) activeStreams.delete(key);
  });

  activeStreams.set(key, entry);

  opusStream.once('end', () => {
    if (dgOpen) {
      dgSocket.send(JSON.stringify({ type: 'CloseStream' }));
    } else {
      dgSocket.close();
    }
  });
}

function stopTranscribing(guildId) {
  for (const [key, streams] of activeStreams) {
    if (key.startsWith(`${guildId}:`)) {
      streams?.opusStream.destroy();
      streams?.dgSocket.close();
      activeStreams.delete(key);
    }
  }
}

async function handleCaptionsStart(interaction) {
  const channel = interaction.member.voice.channel;
  if (!channel) {
    await interaction.reply({ content: 'Invoker must be injoice channel.', ephemeral: true });
    return;
  }

  const guildId = channel.guild.id;

  const existing = getSession(guildId);
  if (existing) {
    await interaction.reply({
      content: `This server already has an active session in <#${existing.channelId}>. Stop it first with \`/disco leave\`.`,
      ephemeral: true,
    });
    return;
  }

  if (activeSessionCount() >= MAX_ACTIVE_SESSIONS) {
    await interaction.reply({
      content: 'Disco is at capacity across all servers right now. Try again later.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply(
    `Joining **${channel.name}**`,
  );

  await ensureMembersFetched(channel.guild);

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId,
    adapterCreator: channel.guild.voiceAdapterCreator,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

  const roster = buildRoster(channel);

  const voiceStateListener = (oldState, newState) => {
    const session = getSession(guildId);
    if (!session) return;
    if (oldState.channelId !== session.channelId && newState.channelId !== session.channelId) return;
    const membershipChanged = oldState.channelId !== newState.channelId;
    if (membershipChanged && oldState.id === session.ownerId && oldState.channelId === session.channelId) {
      stopCaptions(guildId);
      return;
    }
    const muteOrDeafChanged = oldState.mute !== newState.mute || oldState.deaf !== newState.deaf;
    if (!membershipChanged && !muteOrDeafChanged) return; // ignore e.g. video/stream toggles
    const trackedChannelObj = client.channels.cache.get(session.channelId);
    if (!trackedChannelObj) return;
    const updatedRoster = buildRoster(trackedChannelObj);
    setRoster(guildId, updatedRoster);
    broadcastToSession(guildId, { type: 'roster', channelId: session.channelId, members: updatedRoster });
  };

  createSession(guildId, { channelId: channel.id, ownerId: interaction.user.id, voiceStateListener });
  setRoster(guildId, roster);
  broadcastToSession(guildId, { type: 'roster', channelId: channel.id, members: roster });

  client.on(Events.VoiceStateUpdate, voiceStateListener);

  connection.receiver.speaking.on('start', (userId) => {
    broadcastToSession(guildId, { type: 'speaking', channelId: channel.id, speakerId: userId, isSpeaking: true });
    startTranscribing(guildId, channel.id, connection, userId);
  });
  // SpeakingMap emits 'end' (not 'stop') ~100ms after a user's last audio packet.
  connection.receiver.speaking.on('end', (userId) => {
    broadcastToSession(guildId, { type: 'speaking', channelId: channel.id, speakerId: userId, isSpeaking: false });
  });
}

function stopCaptions(guildId) {
  const connection = getVoiceConnection(guildId);
  if (!connection) return;

  stopTranscribing(guildId);
  const session = endSession(guildId);
  if (session?.voiceStateListener) {
    client.off(Events.VoiceStateUpdate, session.voiceStateListener);
  }
  connection.destroy();
}

async function handleCaptionsStop(interaction) {
  if (!getVoiceConnection(interaction.guild.id)) {
    await interaction.reply({ content: 'Not currently in a voice channel.', ephemeral: true });
    return;
  }

  stopCaptions(interaction.guild.id);
  await interaction.reply('Listening stopped, left the voice channel.');
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'disco') {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'join') {
      await handleCaptionsStart(interaction);
    } else if (subcommand === 'leave') {
      await handleCaptionsStop(interaction);
    } else if (subcommand === 'ping') {
      await interaction.reply('Pong!');
    }
  }
});

export async function startBot() {
  const rest = new REST().setToken(DISCORD_BOT_TOKEN);
  await rest.put(
    Routes.applicationCommands(DISCORD_APPLICATION_ID),
    { body: commands },
  );
  await client.login(DISCORD_BOT_TOKEN);
}
```

- [ ] **Step 5: Update `.env.example`**

Remove the `DISCORD_SERVER_ID=` line (no longer used - the bot now operates across every
guild it's invited to) and add `MAX_ACTIVE_SESSIONS`:

```
# Copy to .env and fill in values - never commit .env itself.
DISCORD_APPLICATION_ID=
DISCORD_PUBLIC_KEY=
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_SECRET=
DEEPGRAM_API_KEY=
# PORT - optional, defaults to 3000
PORT=
# PUBLIC_BASE_URL - hosted-deployment only, e.g. https://captions.yourdomain.com; leave unset for local dev.
# Must exactly match your Cloudflare Tunnel hostname and the redirect URI registered in the
# Discord Developer Portal - see docs/deployment.md. Quick tunnels (no domain) get a new
# hostname on every restart, so this value (and the Discord redirect URI) must be updated
# each time.
PUBLIC_BASE_URL=
# MAX_ACTIVE_SESSIONS - optional, defaults to 5. Global cap on simultaneous active
# /disco join sessions across all guilds combined (cost control for Deepgram usage).
MAX_ACTIVE_SESSIONS=
```

- [ ] **Step 6: Run the full automated test suite now that both files are in place**

Run: `node --test`
Expected: PASS - all tests in `gateway.test.js` (13 tests), `sessionRegistry.test.js`
(7 tests), and every other existing `*.test.js` file (e.g.
`client/src/main/serverScheme.test.js`, `client/src/main/wsClient.test.js`) pass.
`bot.js` itself has no unit tests to run, but this confirms the module graph loads (the
circular import between `gateway.js` and `bot.js` resolves) and nothing else regressed.

- [ ] **Step 7: Commit**

```bash
git add gateway.js gateway.test.js bot.js .env.example
git commit -m "feat: route sessions per guild with continuous live-channel authorization"
```

---

### Task 3: Manual end-to-end verification

**Files:** none (no code changes - this task is a verification checklist run against a
real Discord bot and two test guilds).

**Interfaces:** N/A.

- [ ] **Step 1: Re-invite the bot with global command scope**

Since slash-command registration moved from per-guild to global (`Routes.applicationCommands`
in Task 2), confirm the bot's OAuth invite URL still includes the `applications.commands`
scope, then wait for global command propagation (can take up to ~1hr after first deploy of
this change) before testing `/disco` in a guild that only had the old guild-scoped command.

- [ ] **Step 2: Verify isolated concurrent sessions across two guilds**

Using two separate test Discord guilds (both with the bot invited):
1. In Guild A, join a voice channel and run `/disco join`. Confirm the reply names the
   correct channel.
2. In Guild B, from a different voice channel, run `/disco join`. Confirm this succeeds
   independently (it must not be blocked by Guild A's active session).
3. Connect a client (or two) authenticated as users in each guild's respective active
   channel. Confirm each client only ever receives transcript/roster/speaking messages
   for its own guild - never the other guild's.

- [ ] **Step 3: Verify one-session-per-guild enforcement**

In Guild A (already active from Step 2), have a second voice channel run `/disco join`.
Confirm it replies with the "already has an active session" error and does not start a
second connection.

- [ ] **Step 4: Verify the concurrency cap**

Temporarily set `MAX_ACTIVE_SESSIONS=1` in `.env`, restart, start one session, then
attempt a second `/disco join` in a different guild. Confirm it replies with the
"at capacity" error. Restore the original `MAX_ACTIVE_SESSIONS` value afterward.

- [ ] **Step 5: Verify continuous (not just connect-time) authorization**

With an active session and a connected, authorized client, have that user leave the
voice channel entirely. Confirm the client stops receiving further transcript/roster
updates (no error needed - just silence, per the design's Section 3.1). Have them rejoin
the same channel and confirm updates resume without reconnecting the client.

- [ ] **Step 6: Verify the profile header still works across guilds**

For a user who is a member of a guild other than the one they most recently had an active
session in, confirm `/api/me` (the existing profile header feature) still resolves their
username/avatar/status correctly via `getUserProfile`'s guild-shared-membership fallback.
