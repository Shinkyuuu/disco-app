# Electron Client, Backend Auth & Hosting - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take `discord-echo` from its current single-file bot (`index.js`, unauthenticated overlay) to the full system described in `docs/design/bot-backend-design.md` and `docs/design/electron-client-design.md`: a split backend (`bot.js`/`gateway.js`/`auth.js`) with Discord OAuth + token-gated WebSocket access, and a real Electron+React desktop client - then hosted on AWS EC2 per `docs/development-plan.md` §4.

**Architecture:** Backend stays a single Node.js process (bot + HTTP + WS gateway), now split into three cooperating modules with a first-message WebSocket auth handshake. The Electron client is a separate app (`client/`) with a main-process-owned WebSocket connection so the connection and message log outlive individual window lifecycles. Implementation follows the exact Part numbering from `electron-client-design.md` §7 (Parts 10–15), plus a new Part 16 for EC2 hosting (`development-plan.md` §4, referenced as an open item in both design docs).

**Tech Stack:** Node.js (ESM, `"type": "module"`), `discord.js`, `@discordjs/voice`, `ws`, `node:test` (built-in, no new test dependency) for backend and pure-logic client code; Electron + React via `electron-vite` scaffolding, `electron-store` for client settings.

## Global Constraints

These apply to every task below; individual tasks don't repeat them.

- Node.js ESM (`"type": "module"`) throughout - no CommonJS files except where Electron requires it (preload scripts, noted per-task).
- Target Node v20+; developed/verified against v22.12.0 (confirmed current local version).
- OAuth scope is `identify` only - never request `guilds`.
- Session tokens: `crypto.randomBytes(32).toString('hex')`, stored in an in-memory `Map<token, {userId, expiresAt}>`, TTL **4 hours**, no persistence (bot restart = everyone re-logs in - accepted tradeoff, do not add a database).
- The WebSocket auth handshake uses the client's **first message** (`{"type":"auth","token":"..."}`), never a query param - this was corrected in a prior design review specifically to avoid token leakage into proxy/access logs.
- Auth handshake timeout: 5000ms. Close codes: `4001` not in voice channel, `4002` invalid auth payload, `4003` invalid/expired token, `4008` auth timeout. (4000–4999 is the RFC 6455 private-use range.)
- Electron: `contextIsolation: true`, `nodeIntegration: false` everywhere. Renderer never gets direct Node/Electron API access - only through `contextBridge`-exposed `window.api`.
- No new production dependencies beyond what's explicitly named in a task. No test framework beyond Node's built-in `node:test`/`node:assert` - do not add Jest/Vitest/Mocha.
- No packaging, code signing, or auto-updater in this plan - matches `electron-client-design.md` §6's explicit non-goals. `client/` runs via `npm run dev` only.
- Single global session throughout - one guild, one tracked voice channel, at a time. Do not add multi-guild/multi-session support.
- Voice-channel membership is checked once, at WebSocket connect time, never re-verified continuously.
- Chat log is in-memory only, cleared on logout or app quit - never written to disk.
- All speaking-state animations use CSS `transform`/`opacity` only (GPU-compositor-friendly, no layout thrashing).
- Whenever a task needs something only you can provide (API secrets, image assets, AWS/domain access), it is marked **🔴 MANUAL INPUT NEEDED** with the exact thing to provide before that task can be verified.
- `.env.example` (created in Task 3, updated in Task 26) must be kept in sync whenever a task introduces a new environment variable - it's the single reference for "what needs to be in `.env`."

🔴 **MANUAL INPUT NEEDED - a second Discord account/person.** Several verify steps (Tasks 6, 8, 17, 18) require someone else to join/leave the voice channel or speak alongside you, to confirm roster sync and multi-speaker attribution actually distinguish two people. A single-account test can't exercise this. Line up a friend, alt account, or second device before reaching Task 6.

### Confirmed baseline (read before starting)

- `index.js` (~225 lines) is the current, working, single-file implementation - already includes two bug fixes from a prior review: identity-based `activeStreams` cleanup on the Deepgram socket's `close`/`error` events, and a post-`resolveSpeaker` cancellation check. **Task 1 must preserve this exact behavior**, not regress it.
- `package.json` dependencies today: `@discordjs/voice`, `discord.js`, `dotenv`, `opusscript`, `prism-media`, `wav`, `ws`. `"type": "module"`.
- `.env` today has: `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_SERVER_ID`, `DEEPGRAM_API_KEY`. `DISCORD_CLIENT_SECRET` is new, added in Task 3.
- `overlay.html` is served by the current HTTP server and will be deleted in Task 10 once the Electron client replaces it.
- Discord's OAuth2 "Application ID" (already in `.env` as `DISCORD_APPLICATION_ID`) **is** the OAuth2 "Client ID" - no separate client-ID env var is needed.

---

## File Structure

**Backend (repo root):**
- `bot.js` - Discord client, voice capture, per-speaker Deepgram STT pipeline, roster/speaking tracking, tracked-channel state (moved from `index.js`, extended in Parts 10–11)
- `gateway.js` - HTTP server, WebSocket server, generic `broadcast()`, WS-connect auth gate (moved from `index.js`, extended in Parts 10–11)
- `auth.js` - OAuth login/callback handlers, opaque session-token store (new, Part 10)
- `index.js` - thin entry point: loads env, starts gateway, starts bot
- `auth.test.js`, `gateway.test.js` - colocated `node:test` files (new)

**Client (`client/`, new Electron+React app, scaffolded in Task 10):**
- `client/src/main/index.js` - Electron main process: window management, protocol registration, IPC wiring
- `client/src/main/protocolUrl.js` - pure `discord-echo://` URL parser (testable without Electron)
- `client/src/main/store.js` - `electron-store` wrapper for persisted settings
- `client/src/main/wsClient.js` - app-owned WebSocket connection manager + in-memory message log
- `client/src/main/backoff.js` - pure exponential-backoff delay calculator
- `client/src/preload/index.js` - `contextBridge` API surface exposed to the renderer
- `client/src/renderer/src/App.jsx` - view router (`?view=launcher` vs `?view=chat`, no router library needed for two views)
- `client/src/renderer/src/LauncherView.jsx` - Settings + Start Chat Window, login/error states
- `client/src/renderer/src/ChatView.jsx` - composes `SpeakerStrip` + `MessageLog`, error states
- `client/src/renderer/src/SpeakerStrip.jsx` - roster + speaking-state rendering, both avatar modes
- `client/src/renderer/src/MessageLog.jsx` - scrolling message log with interim/final line locking
- `client/src/main/protocolUrl.test.js`, `client/src/main/backoff.test.js`, `client/src/main/wsClient.test.js` - colocated `node:test` files

---

## Part 10 - Backend module split, OAuth, session tokens

### Task 1: Split `index.js` into `bot.js` / `gateway.js` / `index.js`

Pure refactor - no behavior change. Preserves the existing bug fixes verbatim.

**Files:**
- Create: `bot.js`
- Create: `gateway.js`
- Modify: `index.js` (replace entirely)
- Delete: none yet (`overlay.html` stays until Task 10)

**Interfaces:**
- Produces (`gateway.js`): `export const httpServer`, `export const PORT_NUMBER`, `export function broadcastTranscript(event)`, `export function startGateway()`
- Produces (`bot.js`): `export async function startBot()`
- Consumes: `bot.js` imports `{ broadcastTranscript, PORT_NUMBER }` from `./gateway.js`

- [ ] **Step 1: Create `gateway.js`**

```js
import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';

const { PORT } = process.env;
export const PORT_NUMBER = PORT || 3000;

const OVERLAY_HTML = fs.readFileSync('overlay.html');

export const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(OVERLAY_HTML);
});

const gatewayClients = new Set();
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  gatewayClients.add(ws);
  ws.on('close', () => gatewayClients.delete(ws));
});

export function broadcastTranscript(event) {
  const payload = JSON.stringify(event);
  for (const client of gatewayClients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

export function startGateway() {
  httpServer.listen(PORT_NUMBER, () => {
    console.log(`Caption overlay available at http://localhost:${PORT_NUMBER}`);
  });
}
```

- [ ] **Step 2: Create `bot.js`**

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
import { broadcastTranscript, PORT_NUMBER } from './gateway.js';

const { DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, DISCORD_SERVER_ID, DEEPGRAM_API_KEY } = process.env;

const DEEPGRAM_URL = 'wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=48000&channels=2&endpointing=300&model=nova-3';

const commands = [
  { name: 'ping', description: 'Replies with Pong!' },
  {
    name: 'captions',
    description: 'Manage live captions for this voice channel',
    options: [
      {
        name: 'start',
        description: 'Join your voice channel and start live captions',
        type: ApplicationCommandOptionType.Subcommand,
      },
      {
        name: 'stop',
        description: 'Stop captions and leave the voice channel',
        type: ApplicationCommandOptionType.Subcommand,
      },
    ],
  },
];

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

async function resolveSpeaker(guildId, userId) {
  const guild = client.guilds.cache.get(guildId);
  const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId);
  return { username: member.displayName, avatarURL: member.displayAvatarURL({ extension: 'png', size: 128 }) };
}

// key: `${guildId}:${userId}` -> { opusStream, dgSocket } | null (reserved while resolving speaker)
const activeStreams = new Map();

async function startTranscribing(guildId, connection, userId) {
  const key = `${guildId}:${userId}`;
  if (activeStreams.has(key)) return;
  activeStreams.set(key, null);

  const speaker = await resolveSpeaker(guildId, userId);

  // /captions stop may have run while the attribution lookup above was in flight.
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
    broadcastTranscript({
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
    await interaction.reply({ content: 'Join a voice channel first.', ephemeral: true });
    return;
  }

  await interaction.reply(
    `Joining **${channel.name}** - open the overlay at http://localhost:${PORT_NUMBER} to see captions.`,
  );

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

  connection.receiver.speaking.on('start', (userId) => {
    startTranscribing(channel.guild.id, connection, userId);
  });
}

async function handleCaptionsStop(interaction) {
  const connection = getVoiceConnection(interaction.guild.id);
  if (!connection) {
    await interaction.reply({ content: 'Not currently in a voice channel.', ephemeral: true });
    return;
  }

  stopTranscribing(interaction.guild.id);
  connection.destroy();
  await interaction.reply('Captions stopped, left the voice channel.');
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'ping') {
    await interaction.reply('Pong!');
  } else if (interaction.commandName === 'captions') {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'start') {
      await handleCaptionsStart(interaction);
    } else if (subcommand === 'stop') {
      await handleCaptionsStop(interaction);
    }
  }
});

export async function startBot() {
  const rest = new REST().setToken(DISCORD_BOT_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(DISCORD_APPLICATION_ID, DISCORD_SERVER_ID),
    { body: commands },
  );
  await client.login(DISCORD_BOT_TOKEN);
}
```

- [ ] **Step 3: Replace `index.js`**

```js
import 'dotenv/config';
import { startGateway } from './gateway.js';
import { startBot } from './bot.js';

startGateway();
await startBot();
```

Each of `bot.js`/`gateway.js` also has its own `import 'dotenv/config'` - this is safe, not wasteful: ES module instances are cached process-wide, so `dotenv/config`'s top-level `.env`-loading code runs exactly once no matter how many files import it. This removes any fragile assumption about which file happens to import it first.

- [ ] **Step 4: Manual verify**

Run: `npm start`
Expected: identical behavior to before the split -
1. Bot logs in, `/ping` replies "Pong!"
2. `/captions start` in a voice channel joins it and replies with the overlay link
3. Speaking in the channel produces console transcript lines and live updates in `overlay.html` (open `http://localhost:3000`)
4. `/captions stop` leaves the channel and stops transcription

- [ ] **Step 5: Commit**

```bash
git add bot.js gateway.js index.js
git commit -m "refactor: split index.js into bot.js/gateway.js/index.js"
```

---

### Task 2: `auth.js` session token store

**Files:**
- Create: `auth.js`
- Create: `auth.test.js`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Produces: `export function createSessionToken(userId: string): string`, `export function verifySessionToken(token: string): string | null`

- [ ] **Step 1: Add the test script**

Edit `package.json`'s `"scripts"` block:

```json
"scripts": {
  "test": "node --test auth.test.js gateway.test.js",
  "start": "node index.js",
  "transcribe": "node transcribe.js"
}
```

(Explicit file list, not a recursive glob - `client/` is a separate npm project with its own `test` script added in Part 12; keeping root's `node --test` scoped avoids it trying to load client-side test files that depend on `client/node_modules`.)

- [ ] **Step 2: Write the failing test**

```js
// auth.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionToken, verifySessionToken } from './auth.js';

test('createSessionToken then verifySessionToken returns the same userId', () => {
  const token = createSessionToken('user-123');
  assert.equal(verifySessionToken(token), 'user-123');
});

test('verifySessionToken returns null for an unknown token', () => {
  assert.equal(verifySessionToken('not-a-real-token'), null);
});

test('verifySessionToken returns null and purges an expired token', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const token = createSessionToken('user-456');
  t.mock.timers.tick(4 * 60 * 60 * 1000 + 1); // just past the 4h TTL
  assert.equal(verifySessionToken(token), null);
  assert.equal(verifySessionToken(token), null); // purged, not just "expired but still there"
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test auth.test.js`
Expected: FAIL with `Cannot find module './auth.js'`

- [ ] **Step 4: Write minimal implementation**

```js
// auth.js
import crypto from 'node:crypto';

const SESSION_TOKEN_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// token -> { userId, expiresAt }
const sessionTokens = new Map();

export function createSessionToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessionTokens.set(token, { userId, expiresAt: Date.now() + SESSION_TOKEN_TTL_MS });
  return token;
}

export function verifySessionToken(token) {
  const entry = sessionTokens.get(token);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    sessionTokens.delete(token);
    return null;
  }
  return entry.userId;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test auth.test.js`
Expected: PASS, 3/3 tests

- [ ] **Step 6: Commit**

```bash
git add auth.js auth.test.js package.json
git commit -m "feat: add session token store to auth.js"
```

---

### Task 3: `auth.js` OAuth login/callback handlers

🔴 **MANUAL INPUT NEEDED before this task can be verified end-to-end:**
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → your application → **OAuth2** tab.
2. Copy the **Client Secret** and add it to `.env` as `DISCORD_CLIENT_SECRET=...` (never commit it - `.env` is already gitignored).
3. In the same OAuth2 tab, under **Redirects**, add exactly: `http://localhost:3000/auth/callback` (adjust the port if your `.env`'s `PORT` isn't 3000).

**Files:**
- Modify: `auth.js`
- Modify: `auth.test.js`

**Interfaces:**
- Consumes: `createSessionToken` (Task 2, same file)
- Produces: `export function buildAuthorizeUrl(): string`, `export function handleAuthLogin(req, res): void`, `export async function handleAuthCallback(req, res): Promise<void>`

- [ ] **Step 1: Write the failing test (pure logic only - no network)**

```js
// append to auth.test.js
import { buildAuthorizeUrl } from './auth.js';

test('buildAuthorizeUrl includes the required OAuth params', () => {
  const url = new URL(buildAuthorizeUrl());
  assert.equal(url.origin + url.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'identify');
  assert.equal(url.searchParams.get('client_id'), process.env.DISCORD_APPLICATION_ID);
  assert.equal(url.searchParams.get('redirect_uri'), `http://localhost:${process.env.PORT || 3000}/auth/callback`);
});
```

This test needs `.env` loaded (for `DISCORD_APPLICATION_ID`) - add `import 'dotenv/config';` as the first line of `auth.test.js` if not already present via a transitive import.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test auth.test.js`
Expected: FAIL - `buildAuthorizeUrl is not a function` (not exported yet)

- [ ] **Step 3: Write the implementation**

```js
// append to auth.js
const { DISCORD_APPLICATION_ID, DISCORD_CLIENT_SECRET } = process.env;
const PORT_NUMBER = process.env.PORT || 3000;
const REDIRECT_URI = `http://localhost:${PORT_NUMBER}/auth/callback`;

export function buildAuthorizeUrl() {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', DISCORD_APPLICATION_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', 'identify');
  return url.toString();
}

export function handleAuthLogin(req, res) {
  res.writeHead(302, { Location: buildAuthorizeUrl() });
  res.end();
}

async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    client_id: DISCORD_APPLICATION_ID,
    client_secret: DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Discord token exchange failed: ${res.status}`);
  return res.json();
}

async function fetchDiscordUserId(accessToken) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Discord user fetch failed: ${res.status}`);
  const user = await res.json();
  return user.id;
}

export async function handleAuthCallback(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT_NUMBER}`);

  // Discord redirects here with ?error=access_denied (standard OAuth2 behavior) when the
  // user declines on the consent screen - forward it through the same deep-link mechanism
  // as a success, carrying an error instead of a token, so the Electron app can show a
  // real in-app retry state instead of leaving the user stuck on a bare browser page.
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    res.writeHead(302, { Location: `discord-echo://auth?error=${encodeURIComponent(oauthError)}` });
    res.end();
    return;
  }

  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Missing code');
    return;
  }

  try {
    const { access_token } = await exchangeCodeForToken(code);
    const userId = await fetchDiscordUserId(access_token);
    const sessionToken = createSessionToken(userId);
    res.writeHead(302, { Location: `discord-echo://auth?token=${sessionToken}` });
    res.end();
  } catch (err) {
    console.error('OAuth callback failed:', err);
    res.writeHead(302, { Location: `discord-echo://auth?error=callback_failed` });
    res.end();
  }
}
```

`fetch` is a Node 18+ global - no new dependency needed. Both failure paths now redirect back into the app via the `discord-echo://` protocol (same as success) rather than dead-ending in the browser - this is what lets `LauncherView` (Task 14) show a real retry UI instead of the user being stuck reading a plain-text browser page with no way back to the app.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test auth.test.js`
Expected: PASS, 4/4 tests

- [ ] **Step 5: Manual verify (requires the 🔴 manual input above)**

1. `npm start`
2. Visit `http://localhost:3000/auth/login` in a browser → should redirect to Discord's OAuth consent screen showing your app name and "identify" as the only requested permission.
3. Approve it → Discord redirects to `http://localhost:3000/auth/callback?code=...` → your server should then redirect to `discord-echo://auth?token=<64-hex-chars>`. The browser will likely show "can't open this link" (expected - no app is registered for that protocol yet, that's Task 13). Confirm via the browser's network tab / address bar that the redirect target is correctly formed with a real token.
4. Repeat, but click **Cancel** on the consent screen instead of approving - confirm the redirect target is `discord-echo://auth?error=access_denied` instead of a bare 400/502 page.

- [ ] **Step 6: Commit**

```bash
git add auth.js auth.test.js .env.example
git commit -m "feat: add OAuth login/callback handlers to auth.js"
```

(If no `.env.example` exists yet, create one now listing variable names only, no values, including the new `DISCORD_CLIENT_SECRET` - do not commit `.env` itself.)

---

### Task 4: Generalize the broadcast function and wire auth routes into the HTTP server

**Files:**
- Modify: `gateway.js`
- Modify: `bot.js`

**Interfaces:**
- Consumes: `handleAuthLogin`, `handleAuthCallback` from `./auth.js`
- Produces (`gateway.js`): `export function broadcast(payload)` (replaces `broadcastTranscript`)

- [ ] **Step 1: Rename `broadcastTranscript` → `broadcast` in `gateway.js`, add routing**

```js
// gateway.js - replace the httpServer definition and broadcastTranscript function
import { handleAuthLogin, handleAuthCallback } from './auth.js';

export const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/auth/login') return handleAuthLogin(req, res);
  if (url.pathname === '/auth/callback') return handleAuthCallback(req, res);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(OVERLAY_HTML);
});

// ... (gatewayClients, wss, wss.on('connection', ...) unchanged for now - auth gate lands in Task 5)

export function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of gatewayClients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}
```

- [ ] **Step 2: Update `bot.js`'s call site**

```js
// bot.js - update the import and the dgSocket 'message' handler
import { broadcast, PORT_NUMBER } from './gateway.js';

// inside dgSocket.on('message', ...):
broadcast({
  type: 'transcript',
  speakerId: userId,
  username: speaker.username,
  avatarURL: speaker.avatarURL,
  text: transcript,
  isFinal: msg.is_final,
});
```

- [ ] **Step 3: Manual verify**

Run: `npm start`, visit `http://localhost:3000/auth/login` (still redirects correctly), visit `http://localhost:3000` (overlay still loads), speak in the tracked channel and confirm `overlay.html` still receives `transcript`-typed messages (open browser devtools Network/WS tab to inspect the payload's new `"type":"transcript"` field).

- [ ] **Step 4: Commit**

```bash
git add gateway.js bot.js
git commit -m "refactor: generalize broadcastTranscript to broadcast(), route /auth/* into the HTTP server"
```

---

### Task 5: WebSocket-connect auth gate

**Files:**
- Modify: `gateway.js`
- Modify: `bot.js`
- Create: `gateway.test.js`

**Interfaces:**
- Consumes: `verifySessionToken` from `./auth.js`; `isUserInTrackedChannel` from `./bot.js`
- Produces (`gateway.js`): `export function createAuthGate({ verifyToken, isAuthorized, getRosterSnapshot, timeoutMs })`
- Produces (`bot.js`): `export function isUserInTrackedChannel(userId: string): boolean`, `export function getRoster(): Array<{speakerId, username, avatarURL}>`

Note on the import shape: `gateway.js` imports `isUserInTrackedChannel`/`getRoster` from `bot.js`, and `bot.js` imports `broadcast`/`PORT_NUMBER` from `gateway.js` - this is a circular import, which is safe in ES modules **because every cross-reference is only read inside a function body, never at module-evaluation time**. Both modules finish loading before any Discord event or WebSocket connection can fire, so the live bindings are always resolved by the time they're used.

- [ ] **Step 1: Add tracked-channel state to `bot.js`**

```js
// bot.js - add near the top, after activeStreams
let trackedChannel = null; // { guildId, channelId } | null - single global session
let roster = []; // [{ speakerId, username, avatarURL }]

export function isUserInTrackedChannel(userId) {
  if (!trackedChannel) return false;
  const guild = client.guilds.cache.get(trackedChannel.guildId);
  return guild?.members.cache.get(userId)?.voice.channelId === trackedChannel.channelId;
}

export function getRoster() {
  return roster;
}
```

Set `trackedChannel = { guildId: channel.guild.id, channelId: channel.id };` inside `handleCaptionsStart`, right after `entersState(...)` resolves. Clear `trackedChannel = null; roster = [];` at the top of `stopTranscribing`'s caller - i.e. inside `handleCaptionsStop`, right after `stopTranscribing(interaction.guild.id)`.

- [ ] **Step 2: Write the failing test for the auth gate (dependency-injected, no Discord/bot.js needed)**

```js
// gateway.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer, WebSocket } from 'ws';
import { createAuthGate } from './gateway.js';

function startTestServer(gateOptions) {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => {
      const { port } = wss.address();
      wss.on('connection', createAuthGate(gateOptions));
      resolve({ wss, port });
    });
  });
}

test('accepts a connection with a valid token for an authorized user, and sends roster', async () => {
  const { wss, port } = await startTestServer({
    verifyToken: (token) => (token === 'good-token' ? 'user-1' : null),
    isAuthorized: (userId) => userId === 'user-1',
    getRosterSnapshot: () => [{ speakerId: 'user-1', username: 'Alice', avatarURL: 'https://x/a.png' }],
    timeoutMs: 1000,
  });
  const ws = new WebSocket(`ws://localhost:${port}`);
  await new Promise((resolve) => ws.once('open', resolve));
  const firstMessage = new Promise((resolve) => ws.once('message', (data) => resolve(JSON.parse(data.toString()))));
  ws.send(JSON.stringify({ type: 'auth', token: 'good-token' }));
  const roster = await firstMessage;
  assert.equal(roster.type, 'roster');
  assert.equal(roster.members[0].username, 'Alice');
  assert.equal(ws.readyState, WebSocket.OPEN);
  ws.close();
  wss.close();
});

test('closes with 4003 for an invalid token', async () => {
  const { wss, port } = await startTestServer({
    verifyToken: () => null,
    isAuthorized: () => true,
    getRosterSnapshot: () => [],
    timeoutMs: 1000,
  });
  const ws = new WebSocket(`ws://localhost:${port}`);
  await new Promise((resolve) => ws.once('open', resolve));
  const closePromise = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
  ws.send(JSON.stringify({ type: 'auth', token: 'bad-token' }));
  assert.equal(await closePromise, 4003);
  wss.close();
});

test('closes with 4001 when the user is not in the tracked voice channel', async () => {
  const { wss, port } = await startTestServer({
    verifyToken: () => 'user-1',
    isAuthorized: () => false,
    getRosterSnapshot: () => [],
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
    isAuthorized: () => true,
    getRosterSnapshot: () => [],
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
    isAuthorized: () => true,
    getRosterSnapshot: () => [],
    timeoutMs: 50,
  });
  const ws = new WebSocket(`ws://localhost:${port}`);
  const closePromise = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
  assert.equal(await closePromise, 4008);
  wss.close();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test gateway.test.js`
Expected: FAIL - `createAuthGate is not a function`

- [ ] **Step 4: Implement the auth gate in `gateway.js`**

```js
// gateway.js - add, and change the wss.on('connection', ...) wiring
import { verifySessionToken } from './auth.js';
import { isUserInTrackedChannel, getRoster } from './bot.js';

const AUTH_TIMEOUT_MS = 5000;

export function createAuthGate({ verifyToken, isAuthorized, getRosterSnapshot, timeoutMs = AUTH_TIMEOUT_MS }) {
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
      if (!isAuthorized(userId)) {
        ws.close(4001, 'not in voice channel');
        return;
      }
      gatewayClients.add(ws);
      ws.on('close', () => gatewayClients.delete(ws));
      ws.send(JSON.stringify({ type: 'roster', members: getRosterSnapshot() }));
    });
  };
}

wss.on('connection', createAuthGate({
  verifyToken: verifySessionToken,
  isAuthorized: isUserInTrackedChannel,
  getRosterSnapshot: getRoster,
}));
```

Remove the old inline `wss.on('connection', (ws) => { gatewayClients.add(ws); ... })` block - it's replaced by the line above.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test gateway.test.js`
Expected: PASS, 5/5 tests

- [ ] **Step 6: Manual verify with `wscat`**

Install if needed: `npm install -g wscat`

1. `npm start`, `/captions start` in a voice channel you're in.
2. `wscat -c ws://localhost:3000` then send `{"type":"auth","token":"<a valid token from Task 3's manual OAuth flow>"}` - expect a `roster` message back and the connection to stay open.
3. Same, but send a bogus token - expect the connection to close with code `4003`.
4. Same, but connect and send nothing - expect it to close with code `4008` after 5 seconds.

- [ ] **Step 7: Commit**

```bash
git add gateway.js bot.js gateway.test.js
git commit -m "feat: gate WebSocket connections on session token + voice-channel membership"
```

---

## Part 11 - Protocol additions: roster and speaking events

### Task 6: Roster tracking in `bot.js`

**Files:**
- Modify: `bot.js`

**Interfaces:**
- Consumes: `broadcast` (Task 4), `getRoster`/`isUserInTrackedChannel`'s `roster`/`trackedChannel` state (Task 5, same file)

- [ ] **Step 1: Add roster building + `voiceStateUpdate` sync**

```js
// bot.js
function buildRoster(channel) {
  return channel.members.map((member) => ({
    speakerId: member.id,
    username: member.displayName,
    avatarURL: member.displayAvatarURL({ extension: 'png', size: 128 }),
  }));
}

let voiceStateListener = null;
```

Inside `handleCaptionsStart`, right after setting `trackedChannel`:

```js
roster = buildRoster(channel);
broadcast({ type: 'roster', members: roster });

voiceStateListener = (oldState, newState) => {
  if (oldState.channelId === newState.channelId) return; // mute/deafen/etc - no membership change, skip the rebuild
  if (oldState.channelId !== trackedChannel.channelId && newState.channelId !== trackedChannel.channelId) return;
  const trackedChannelObj = client.channels.cache.get(trackedChannel.channelId);
  if (!trackedChannelObj) return;
  roster = buildRoster(trackedChannelObj);
  broadcast({ type: 'roster', members: roster });
};
client.on(Events.VoiceStateUpdate, voiceStateListener);
```

(Without the first check, `voiceStateUpdate` - which Discord fires for *any* voice-state change, not just channel join/leave - would rebuild and re-broadcast the roster on every mute/deafen toggle from someone already in the tracked channel: harmless at this product's scale of 5-15 members, but easy to mistake for a bug later, so the guard is here to make the intent explicit as well as skip the redundant work.)

Inside `handleCaptionsStop`, right after `stopTranscribing(interaction.guild.id)` and the `trackedChannel = null; roster = [];` from Task 5:

```js
if (voiceStateListener) {
  client.off(Events.VoiceStateUpdate, voiceStateListener);
  voiceStateListener = null;
}
```

- [ ] **Step 2: Manual verify**

`/captions start`, have a second person join/leave the voice channel, confirm (via `wscat`, authenticated per Task 5 step 6) a fresh `roster` message arrives each time with the correct member list.

- [ ] **Step 3: Commit**

```bash
git add bot.js
git commit -m "feat: broadcast roster on captions start and voice state changes"
```

---

### Task 7: Speaking events from Discord's own speaking-start/stop

**Files:**
- Modify: `bot.js`

- [ ] **Step 1: Broadcast `speaking` immediately on Discord's native events**

Replace the single `connection.receiver.speaking.on('start', ...)` listener in `handleCaptionsStart` with:

```js
connection.receiver.speaking.on('start', (userId) => {
  broadcast({ type: 'speaking', speakerId: userId, isSpeaking: true });
  startTranscribing(channel.guild.id, connection, userId);
});
connection.receiver.speaking.on('stop', (userId) => {
  broadcast({ type: 'speaking', speakerId: userId, isSpeaking: false });
});
```

This fires immediately on Discord's own speaking events, with no Deepgram round-trip delay - matching `electron-client-design.md` §3.3's stated intent for the `speaking` message.

- [ ] **Step 2: Manual verify**

Via authenticated `wscat`, speak and stop speaking - confirm `speaking` messages with `isSpeaking: true`/`false` arrive near-instantly (well before any `transcript` message for the same utterance).

- [ ] **Step 3: Commit**

```bash
git add bot.js
git commit -m "feat: broadcast speaking events from Discord's native speaking-start/stop"
```

---

### Task 8: Manual protocol verification

**Files:** none (verification-only task)

- [ ] **Step 1: Full manual verify per `electron-client-design.md` §7 Part 11's own instruction**

Using authenticated `wscat` (send the `auth` message first each time):
1. `/captions start` - confirm the initial `roster` message.
2. Have someone join the channel - confirm a follow-up `roster` message including them.
3. Speak - confirm `speaking` (`isSpeaking:true`) fires first, then `transcript` (interim, then final) messages follow, then `speaking` (`isSpeaking:false`) once silence is detected.
4. Have someone leave - confirm a `roster` message without them.
5. `/captions stop` - confirm no further messages arrive and the WS connection isn't force-closed by the server (client-side teardown is a later Part).

- [ ] **Step 2: Commit** (none - no code changes; skip if nothing was modified)

---

## Part 12 - Electron scaffold, custom protocol, OAuth login

### Task 9: Scaffold `client/`, retire `overlay.html`

**Files:**
- Create: `client/` (via scaffolding tool, see below)
- Delete: `overlay.html`
- Modify: `gateway.js` (remove the overlay route)

- [ ] **Step 1: Scaffold the Electron+React app**

From the repo root:

```bash
npm create @quick-start/electron@latest client -- --template react
cd client
npm install
```

This uses `electron-vite`'s official scaffolding tool. It creates `client/package.json` as an **independent** npm project (its own `node_modules`, not a workspace of the root) with the structure: `src/main/index.js`, `src/preload/index.js`, `src/renderer/` (React app), `electron.vite.config.js`.

- [ ] **Step 2: Confirm the scaffold's `.gitignore`**

Check `client/.gitignore` exists and covers `node_modules/`, `out/`, `dist/` (the scaffold generates this automatically - verify it, don't recreate it).

- [ ] **Step 3: Delete `overlay.html` and its route**

```bash
rm overlay.html
```

In `gateway.js`, remove `const OVERLAY_HTML = fs.readFileSync('overlay.html');` and change the httpServer's fallback branch:

```js
export const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/auth/login') return handleAuthLogin(req, res);
  if (url.pathname === '/auth/callback') return handleAuthCallback(req, res);
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found - use the discord-echo Electron client to view captions.');
});
```

Remove the now-unused `import fs from 'node:fs';` if nothing else in `gateway.js` uses it.

- [ ] **Step 4: Manual verify**

- `cd client && npm run dev` opens a blank Electron window with the React template's default page.
- `npm start` (repo root) still runs the bot cleanly; visiting `http://localhost:3000` now returns 404 with the "use the Electron client" message instead of serving the old overlay.

- [ ] **Step 5: Commit**

```bash
git add client/ overlay.html gateway.js
git commit -m "feat: scaffold Electron client, retire overlay.html"
```

(This stages the deletion of `overlay.html` alongside the new `client/` tree, so `git add` picks up both.)

---

### Task 10: `protocolUrl.js` - pure `discord-echo://` URL parser

**Files:**
- Create: `client/src/main/protocolUrl.js`
- Create: `client/src/main/protocolUrl.test.js`
- Modify: `client/package.json` (add `test` script)

**Interfaces:**
- Produces: `export function parseAuthToken(deepLinkUrl: string): string | null`, `export function parseAuthError(deepLinkUrl: string): string | null`

- [ ] **Step 1: Add the client's test script**

```json
"scripts": {
  "test": "node --test src/main/protocolUrl.test.js src/main/backoff.test.js src/main/wsClient.test.js"
}
```

(Add to `client/package.json`'s existing `"scripts"` block alongside the scaffold's `dev`/`build` scripts - don't remove those. `wsClient.test.js` and `backoff.test.js` don't exist yet; that's fine, they're added in Tasks 15 and 21 - running this script before then will fail on missing files, which is expected until those tasks land.)

- [ ] **Step 2: Write the failing test**

```js
// client/src/main/protocolUrl.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthToken, parseAuthError } from './protocolUrl.js';

test('extracts the token from a valid discord-echo:// auth URL', () => {
  assert.equal(parseAuthToken('discord-echo://auth?token=abc123'), 'abc123');
});

test('returns null for a non-discord-echo URL', () => {
  assert.equal(parseAuthToken('https://example.com?token=abc123'), null);
});

test('returns null when there is no token param', () => {
  assert.equal(parseAuthToken('discord-echo://auth'), null);
});

test('returns null for a malformed URL', () => {
  assert.equal(parseAuthToken('not a url'), null);
});

test('parseAuthError extracts the error from a denied-login redirect', () => {
  assert.equal(parseAuthError('discord-echo://auth?error=access_denied'), 'access_denied');
});

test('parseAuthError returns null when there is no error param', () => {
  assert.equal(parseAuthError('discord-echo://auth?token=abc123'), null);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `client/`): `node --test src/main/protocolUrl.test.js`
Expected: FAIL - `Cannot find module './protocolUrl.js'`

- [ ] **Step 4: Write the implementation**

```js
// client/src/main/protocolUrl.js
function parseDeepLink(deepLinkUrl) {
  try {
    const parsed = new URL(deepLinkUrl);
    return parsed.protocol === 'discord-echo:' ? parsed : null;
  } catch {
    return null;
  }
}

export function parseAuthToken(deepLinkUrl) {
  return parseDeepLink(deepLinkUrl)?.searchParams.get('token') ?? null;
}

export function parseAuthError(deepLinkUrl) {
  return parseDeepLink(deepLinkUrl)?.searchParams.get('error') ?? null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test src/main/protocolUrl.test.js`
Expected: PASS, 4/4 tests

- [ ] **Step 6: Commit**

```bash
git add client/src/main/protocolUrl.js client/src/main/protocolUrl.test.js client/package.json
git commit -m "feat(client): add discord-echo:// URL token parser"
```

---

### Task 11: `store.js` - persisted settings wrapper

**Files:**
- Create: `client/src/main/store.js`
- Modify: `client/package.json` (add `electron-store` dependency)

**Interfaces:**
- Produces: `export const store` - an `electron-store` instance with keys `serverAddress`, `avatarMode`, `sessionToken`

- [ ] **Step 1: Install `electron-store`**

```bash
cd client
npm install electron-store
```

Note: `electron-store` v11+ is **ESM-only** - it has no CommonJS export. This is fine since `client/src/main/` files are ESM (electron-vite's React template configures the main process as ESM by default - confirm `client/package.json` has `"type": "module"` after scaffolding; if not, this is the point to add it, since `electron-store` requires it).

- [ ] **Step 2: Write `store.js`**

```js
// client/src/main/store.js
import Store from 'electron-store';

export const store = new Store({
  defaults: {
    serverAddress: 'localhost:3000',
    avatarMode: 'discord',
    sessionToken: null,
  },
});
```

- [ ] **Step 3: Manual verify**

This needs the Electron runtime (`app.getPath('userData')` internally) - can't be unit tested with plain `node:test`. From `client/src/main/index.js` (temporarily, or via the app once Task 13 wires it in), call `store.set('serverAddress', 'test-value')`, restart the app, call `store.get('serverAddress')` and confirm it returns `'test-value'`. Also locate the underlying JSON file (Windows: `%APPDATA%/<app-name>/config.json`) and confirm it exists and contains the value.

- [ ] **Step 4: Commit**

```bash
git add client/src/main/store.js client/package.json client/package-lock.json
git commit -m "feat(client): add electron-store settings wrapper"
```

---

### Task 12: Custom protocol registration + `open-url`/`second-instance` + two-window scaffolding

🔴 **Platform note:** custom-protocol handling in **development mode** (`electron .`, unpackaged) only works reliably on **Windows** - Electron's own docs confirm `open-url`/protocol handling on macOS and Linux requires a packaged app. Since you're on Windows 11, dev-mode verification of the full protocol flow works for you; if macOS support is ever needed, that verification has to wait for the packaging pass (explicitly out of scope for this plan).

**Files:**
- Modify: `client/src/main/index.js` (replaces the scaffold's default single-window boilerplate with this app's two-window model)

**Interfaces:**
- Consumes: `parseAuthToken` (Task 10)
- Produces: `deliverAuthToken(token)` (internal), `createLauncherWindow()`, `createChatWindow()` (internal, extended in Task 17)

- [ ] **Step 1: Replace `client/src/main/index.js`**

```js
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
```

`createChatWindow()` is added in Task 17 (Part 13), once there's a WebSocket connection to feed it - adding it now with nothing to display would be dead code.

- [ ] **Step 2: Manual verify (Windows)**

1. `npm run dev` from `client/` - launcher window opens.
2. Close the app. In a browser address bar, type `discord-echo://auth?token=test-manual-token` and press enter - Windows should prompt "Open Electron?" (or similar, using the dev-mode registration) - accept it.
3. Confirm a **new** Electron process briefly starts, then the original app's window is focused (single-instance lock working), and check the console (via `mainWindow.webContents.openDevTools()` temporarily, or main-process console logs) for evidence `handleDeepLink` received `test-manual-token`. Full delivery to the renderer is verified in Task 14 once the preload/IPC bridge exists - this step just confirms protocol registration and argv extraction work.

- [ ] **Step 3: Commit**

```bash
git add client/src/main/index.js
git commit -m "feat(client): register discord-echo:// protocol, handle deep links, launcher window"
```

---

### Task 13: Preload `contextBridge` API surface

**Files:**
- Create: `client/src/preload/index.js` (replaces scaffold default)

**Interfaces:**
- Produces (exposed as `window.api` in the renderer): `onAuthToken(callback)`, `openLogin(serverAddress)`, `getSettings()`, `setSettings(partial)`

- [ ] **Step 1: Write the preload script**

Preload scripts run in a restricted context and conventionally stay CommonJS even in an otherwise-ESM Electron app (Electron's preload loader has more consistent CJS support) - check what the scaffold generated for `client/package.json`'s preload build target; if it emits `.js` under `"type":"module"`, keep this file as `.cjs` explicitly to sidestep any ESM-preload edge cases, and update `electron.vite.config.js`'s preload entry accordingly if needed.

```js
// client/src/preload/index.js (or .cjs, per the note above)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onAuthToken: (callback) => {
    ipcRenderer.on('auth-token', (_event, token) => callback(token));
  },
  onAuthError: (callback) => {
    ipcRenderer.on('auth-error', (_event, reason) => callback(reason));
  },
  openLogin: (serverAddress) => ipcRenderer.invoke('open-login', serverAddress),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (partial) => ipcRenderer.invoke('set-settings', partial),
});
```

- [ ] **Step 2: Add the corresponding `ipcMain` handlers to `client/src/main/index.js`**

```js
// client/src/main/index.js - add imports and handlers
import { ipcMain, shell } from 'electron';
import { store } from './store.js';

ipcMain.handle('open-login', (_event, serverAddress) => {
  shell.openExternal(`http://${serverAddress}/auth/login`);
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
```

Register these handlers inside `app.whenReady().then(() => { ... })`, alongside `createLauncherWindow()`.

Also update `deliverAuthToken` to persist the token: `store.set('sessionToken', token);` right before sending it to the renderer.

- [ ] **Step 3: Manual verify**

`npm run dev`, open devtools in the launcher window's renderer, run `window.api.getSettings()` in the console - confirm it resolves to `{ serverAddress: 'localhost:3000', avatarMode: 'discord', hasSessionToken: false }`.

- [ ] **Step 4: Commit**

```bash
git add client/src/preload/index.js client/src/main/index.js
git commit -m "feat(client): expose contextBridge api surface (auth token, settings, login trigger)"
```

---

### Task 14: `LauncherView.jsx` - Settings + Start Chat Window + full login round trip

🔴 **MANUAL INPUT NEEDED:** this task's end-to-end verify requires the same Discord OAuth app configuration from Task 3 (client secret + registered redirect URI) to already be in place - confirm it still is before starting.

**Files:**
- Create: `client/src/renderer/src/App.jsx` (replaces scaffold default)
- Create: `client/src/renderer/src/LauncherView.jsx`

**Interfaces:**
- Consumes: `window.api.onAuthToken`, `window.api.openLogin`, `window.api.getSettings`, `window.api.setSettings`

- [ ] **Step 1: Write the view router**

```jsx
// client/src/renderer/src/App.jsx
import LauncherView from './LauncherView';
import ChatView from './ChatView';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  if (view === 'chat') return <ChatView />;
  return <LauncherView />;
}
```

(`ChatView` is created in Task 18 - until then, this file won't compile standalone; write it in this task anyway since `App.jsx` needs to reference it, and add a minimal placeholder `ChatView.jsx` now that Task 18 fully replaces.)

```jsx
// client/src/renderer/src/ChatView.jsx (placeholder, replaced in Task 18)
export default function ChatView() {
  return <div>Chat window - not yet implemented (Task 18)</div>;
}
```

- [ ] **Step 2: Write `LauncherView.jsx`**

```jsx
// client/src/renderer/src/LauncherView.jsx
import { useEffect, useState } from 'react';

export default function LauncherView() {
  const [settings, setSettings] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [loginError, setLoginError] = useState(null);

  useEffect(() => {
    window.api.getSettings().then(setSettings);
    window.api.onAuthToken(() => {
      window.api.getSettings().then(setSettings);
      setLoginError(null);
    });
    window.api.onAuthError((reason) => {
      setLoginError(
        reason === 'access_denied'
          ? 'Login was cancelled.'
          : 'Login failed - please try again.',
      );
    });
  }, []);

  if (!settings) return null;

  function handleStartChatWindow() {
    if (!settings.hasSessionToken) {
      setLoginError(null);
      window.api.openLogin(settings.serverAddress).catch(() => setLoginError('Could not open the login page.'));
      return;
    }
    // Chat window creation is wired in Task 17.
  }

  return (
    <div>
      <h1>discord-echo</h1>
      {loginError && (
        <div role="alert">
          <p>{loginError}</p>
          <button onClick={handleStartChatWindow}>Retry</button>
        </div>
      )}
      <button onClick={() => setShowSettings((s) => !s)}>Settings</button>
      <button onClick={handleStartChatWindow}>Start Chat Window</button>
      {showSettings && (
        <div>
          <label>
            Server address
            <input
              value={settings.serverAddress}
              onChange={(e) => setSettings((s) => ({ ...s, serverAddress: e.target.value }))}
              onBlur={(e) => window.api.setSettings({ serverAddress: e.target.value })}
            />
          </label>
          <label>
            Avatar mode
            <select
              value={settings.avatarMode}
              onChange={(e) => {
                const avatarMode = e.target.value;
                setSettings((s) => ({ ...s, avatarMode }));
                window.api.setSettings({ avatarMode });
              }}
            >
              <option value="discord">Discord avatar</option>
              <option value="custom">Custom image</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Manual verify - the full round trip from `electron-client-design.md`'s own Part 12 verify step**

1. `npm run dev` from `client/`, ensure the backend (`npm start` from repo root) is running.
2. Click **Start Chat Window** with no stored token - system browser opens to `http://localhost:3000/auth/login`.
3. Complete the Discord OAuth consent screen.
4. Confirm the browser attempts to open `discord-echo://auth?token=...`, your OS prompts to open it in the Electron app, and the app's `LauncherView` re-renders with `hasSessionToken: true` after `getSettings()` is re-fetched.
5. Repeat, but click **Cancel** on the consent screen - confirm `LauncherView` shows "Login was cancelled." with a working Retry button, instead of nothing happening in the app (this is the design's §5 "OAuth denied... error state on the main window with a retry action" requirement).

- [ ] **Step 4: Commit**

```bash
git add client/src/renderer/src/App.jsx client/src/renderer/src/LauncherView.jsx client/src/renderer/src/ChatView.jsx
git commit -m "feat(client): launcher window with settings and full OAuth login round trip"
```

---

## Part 13 - Chat window core

### Task 15: `wsClient.js` - app-owned WebSocket connection manager

**Files:**
- Create: `client/src/main/wsClient.js`
- Create: `client/src/main/wsClient.test.js`
- Modify: `client/package.json` (add `ws` dependency)

**Interfaces:**
- Produces: `export function createWsClient({ serverAddress, token }): EventEmitter` - emits `'roster'` (members array), `'speaking'` ({speakerId, isSpeaking}), `'transcript'` (payload), `'open'`, `'close'` (code, reason), and has a `.close()` method

- [ ] **Step 1: Install `ws` in `client/`**

```bash
cd client
npm install ws
```

- [ ] **Step 2: Write the failing test**

```js
// client/src/main/wsClient.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { createWsClient } from './wsClient.js';

function startFakeGateway(onMessage) {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 }, () => resolve({ wss, port: wss.address().port }));
    wss.on('connection', (ws) => {
      ws.on('message', (data) => onMessage(ws, JSON.parse(data.toString())));
    });
  });
}

test('sends an auth message immediately on connect, then relays typed events', async () => {
  const { wss, port } = await startFakeGateway((ws, msg) => {
    if (msg.type === 'auth' && msg.token === 'tok-1') {
      ws.send(JSON.stringify({ type: 'roster', members: [{ speakerId: '1', username: 'Alice', avatarURL: 'x' }] }));
    }
  });

  const client = createWsClient({ serverAddress: `localhost:${port}`, token: 'tok-1' });
  const roster = await new Promise((resolve) => client.on('roster', resolve));
  assert.equal(roster[0].username, 'Alice');

  client.close();
  wss.close();
});

test('emits close with the server-provided code and reason', async () => {
  const { wss, port } = await startFakeGateway((ws) => ws.close(4003, 'invalid or expired token'));

  const client = createWsClient({ serverAddress: `localhost:${port}`, token: 'bad-token' });
  const [code, reason] = await new Promise((resolve) => client.on('close', (c, r) => resolve([c, r])));
  assert.equal(code, 4003);
  assert.equal(reason, 'invalid or expired token');

  wss.close();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `client/`): `node --test src/main/wsClient.test.js`
Expected: FAIL - `Cannot find module './wsClient.js'`

- [ ] **Step 4: Write the implementation**

```js
// client/src/main/wsClient.js
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

export function createWsClient({ serverAddress, token }) {
  const emitter = new EventEmitter();
  const ws = new WebSocket(`ws://${serverAddress}/`);

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'auth', token }));
    emitter.emit('open');
  });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === 'roster') emitter.emit('roster', msg.members);
    else if (msg.type === 'speaking') emitter.emit('speaking', { speakerId: msg.speakerId, isSpeaking: msg.isSpeaking });
    else if (msg.type === 'transcript') emitter.emit('transcript', msg);
  });

  ws.on('close', (code, reasonBuf) => {
    emitter.emit('close', code, reasonBuf.toString());
  });

  emitter.close = () => ws.close();
  return emitter;
}
```

Transport is `ws://` (plaintext) intentionally - this matches the accepted-risk transport note in `electron-client-design.md` §3.4; it becomes `wss://` only once hosted (Part 16, Task 27).

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test src/main/wsClient.test.js`
Expected: PASS, 2/2 tests

- [ ] **Step 6: Commit**

```bash
git add client/src/main/wsClient.js client/src/main/wsClient.test.js client/package.json
git commit -m "feat(client): add app-owned WebSocket connection manager"
```

---

### Task 16: Wire `wsClient` into the main process - message log, IPC forwarding, chat window

**Files:**
- Modify: `client/src/main/index.js`

**Interfaces:**
- Produces: `createChatWindow()`, `logout()`, module-level `messageLog` array, IPC channels `state-snapshot`, `roster`, `speaking`, `transcript`, `ws-connection-state` sent to renderer windows; `start-chat-window`/`logout` IPC handlers invoked from the renderer

- [ ] **Step 1: Add WS lifecycle + message log to `client/src/main/index.js`**

```js
// client/src/main/index.js - add
import { createWsClient } from './wsClient.js';

let wsClient = null;
let currentRoster = [];
const messageLog = []; // [{ speakerId, username, avatarURL, text, isFinal }] - finalized entries only, in order, capped at 1000 (see the 'transcript' handler below)

// Named generically, but every channel sent through here (roster/speaking/transcript/
// ws-connection-state) is only ever consumed by ChatView - LauncherView never subscribes
// to any of them - so this targets the chat window only, not every open window.
function broadcastToRenderers(channel, payload) {
  if (chatWindow) chatWindow.webContents.send(channel, payload);
}

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
      // to unboundedly - this is what gets structured-clone'd over IPC on every chat-window
      // reopen (Task 17's state-snapshot), so an unbounded array means an unbounded IPC
      // payload. 1000 lines is far more scrollback than this product's use case (a live
      // conversation, not an archive) ever needs to show on reopen.
      if (messageLog.length > 1000) messageLog.shift();
    }
    broadcastToRenderers('transcript', event);
  });
  wsClient.on('open', () => broadcastToRenderers('ws-connection-state', { status: 'connected' }));
  wsClient.on('close', (code, reason) => {
    broadcastToRenderers('ws-connection-state', { status: 'disconnected', code, reason });
    wsClient = null;
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
      preload: path.join(__dirname, '../preload/index.js'),
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

ipcMain.handle('start-chat-window', () => {
  startWsClient();
  createChatWindow();
});
```

Register the `start-chat-window` handler inside `app.whenReady().then(...)` alongside the others.

- [ ] **Step 2: Add the logout handler - this is where the chat log and connection actually get cleared**

`electron-client-design.md` §4.2 requires the message log and WebSocket connection to be cleared "only on logout or app quit." Quit is handled by the OS tearing down the process; logout needs an explicit action:

```js
// client/src/main/index.js - add
function logout() {
  wsClient?.close();
  wsClient = null;
  messageLog.length = 0;
  currentRoster = [];
  store.delete('sessionToken');
  if (chatWindow) chatWindow.close();
  broadcastToRenderers('ws-connection-state', { status: 'logged-out' });
}

ipcMain.handle('logout', () => logout());

app.on('before-quit', () => {
  wsClient?.close();
});
```

Register `ipcMain.handle('logout', ...)` inside `app.whenReady().then(...)` alongside the other handlers.

- [ ] **Step 3: Expose `startChatWindow` and `logout` via preload**

Add to `client/src/preload/index.js`'s exposed object:

```js
startChatWindow: () => ipcRenderer.invoke('start-chat-window'),
logout: () => ipcRenderer.invoke('logout'),
```

- [ ] **Step 4: Wire `LauncherView`'s button to it**

In `LauncherView.jsx`, replace the `// Chat window creation is wired in Task 17.` comment:

```js
window.api.startChatWindow();
```

- [ ] **Step 5: Manual verify**

Complete login (Task 14), click **Start Chat Window** - launcher window minimizes, a new (still-placeholder) chat window opens. Check main-process console logs confirm `wsClient` connected (`ws-connection-state: connected`). The logout button itself is added in Task 24 (once there's error-state UI to attach it near) - for now, verify the handler works by calling `window.api.logout()` directly from devtools and confirming the chat window closes and `getSettings()` afterward shows `hasSessionToken: false`.

- [ ] **Step 6: Commit**

```bash
git add client/src/main/index.js client/src/preload/index.js client/src/renderer/src/LauncherView.jsx
git commit -m "feat(client): own the WebSocket connection and message log at the app level"
```

---

### Task 17: `ChatView.jsx`, `SpeakerStrip.jsx`, `MessageLog.jsx` (no animation yet)

**Files:**
- Modify: `client/src/renderer/src/ChatView.jsx` (replaces Task 14's placeholder)
- Create: `client/src/renderer/src/SpeakerStrip.jsx`
- Create: `client/src/renderer/src/MessageLog.jsx`
- Modify: `client/src/preload/index.js` (expose the new IPC subscriptions)

**Interfaces:**
- Consumes: `window.api.onRoster`, `window.api.onSpeaking`, `window.api.onTranscript`, `window.api.onStateSnapshot`
- Produces: `<SpeakerStrip roster speakingIds avatarMode />`, `<MessageLog entries interim />`

- [ ] **Step 1: Expose the remaining event subscriptions in preload**

```js
// client/src/preload/index.js - add to the exposed object
onStateSnapshot: (callback) => ipcRenderer.on('state-snapshot', (_e, snapshot) => callback(snapshot)),
onRoster: (callback) => ipcRenderer.on('roster', (_e, members) => callback(members)),
onSpeaking: (callback) => ipcRenderer.on('speaking', (_e, event) => callback(event)),
onTranscript: (callback) => ipcRenderer.on('transcript', (_e, event) => callback(event)),
```

- [ ] **Step 2: Write `MessageLog.jsx`**

Finalized utterances are locked-in lines; an interim utterance updates the *last* line in place if it belongs to the same speaker's still-open utterance, otherwise starts a new (still-interim) line.

```jsx
// client/src/renderer/src/MessageLog.jsx
export default function MessageLog({ entries, interimBySpeaker }) {
  const interimEntries = Object.values(interimBySpeaker);
  return (
    <div className="message-log">
      {entries.map((entry, i) => (
        <div key={i} className="message-line">
          <img src={entry.avatarURL} alt="" width={24} height={24} />
          <strong>{entry.username}</strong>
          <span>{entry.text}</span>
        </div>
      ))}
      {interimEntries.map((entry) => (
        <div key={entry.speakerId} className="message-line message-line--interim">
          <img src={entry.avatarURL} alt="" width={24} height={24} />
          <strong>{entry.username}</strong>
          <span>{entry.text}</span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Write `SpeakerStrip.jsx` (no speaking animation yet - Part 14)**

```jsx
// client/src/renderer/src/SpeakerStrip.jsx
export default function SpeakerStrip({ roster, speakingIds }) {
  return (
    <div className="speaker-strip">
      {roster.map((member) => (
        <img
          key={member.speakerId}
          src={member.avatarURL}
          alt={member.username}
          width={48}
          height={48}
          className={speakingIds.has(member.speakerId) ? 'speaker-icon speaker-icon--speaking' : 'speaker-icon'}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Write `ChatView.jsx`**

```jsx
// client/src/renderer/src/ChatView.jsx
import { useEffect, useState } from 'react';
import SpeakerStrip from './SpeakerStrip';
import MessageLog from './MessageLog';

export default function ChatView() {
  const [roster, setRoster] = useState([]);
  const [speakingIds, setSpeakingIds] = useState(new Set());
  const [entries, setEntries] = useState([]);
  const [interimBySpeaker, setInterimBySpeaker] = useState({});

  useEffect(() => {
    window.api.onStateSnapshot((snapshot) => {
      setRoster(snapshot.roster);
      setEntries(snapshot.messageLog);
    });
    window.api.onRoster(setRoster);
    window.api.onSpeaking(({ speakerId, isSpeaking }) => {
      setSpeakingIds((prev) => {
        const next = new Set(prev);
        if (isSpeaking) next.add(speakerId);
        else next.delete(speakerId);
        return next;
      });
    });
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
    });
  }, []);

  return (
    <div>
      <SpeakerStrip roster={roster} speakingIds={speakingIds} />
      <MessageLog entries={entries} interimBySpeaker={interimBySpeaker} />
    </div>
  );
}
```

- [ ] **Step 5: Manual verify - matches `electron-client-design.md`'s own Part 13 verify step**

With two people talking in the tracked voice channel: confirm two roster icons appear in the speaker strip, and a growing, correctly-attributed scrollback appears in the message log, with interim text updating in place until finalized.

- [ ] **Step 6: Commit**

```bash
git add client/src/renderer/src/ChatView.jsx client/src/renderer/src/SpeakerStrip.jsx client/src/renderer/src/MessageLog.jsx client/src/preload/index.js
git commit -m "feat(client): chat window speaker strip and persistent message log"
```

---

### Task 18: Window lifecycle verification (minimize/restore, scrollback persistence)

**Files:** none (verification-only task)

- [ ] **Step 1: Manual verify**

1. With the chat window open and some scrollback accumulated, close the chat window - confirm the launcher window restores.
2. Click **Start Chat Window** again - confirm a **new** chat window opens showing the **same** scrollback and roster it had before (via the `state-snapshot` IPC message sent on `ready-to-show`), not a blank log - this is the "WebSocket connection and message log are owned by the Electron app, not the chat window's mount lifecycle" requirement from `electron-client-design.md` §4.2.
3. Confirm the WS connection was never re-established (no re-auth, no gap) across this close/reopen cycle - check main-process logs for a single `ws-connection-state: connected` event, not two.

- [ ] **Step 2: Commit** (skip - no code changes)

---

## Part 14 - Speaking animation + avatar modes

### Task 19: 🔴 MANUAL INPUT NEEDED - custom avatar image assets

Before this task's code can be written meaningfully, provide:

1. **Whether custom-avatar mode uses one shared character image for every speaker, or a distinct image per Discord user.** `electron-client-design.md` describes it generically ("icons (your PNGs)") without specifying - this determines whether the mapping is `avatarMode === 'custom' ? sharedImage : member.avatarURL` (one image) or a per-user lookup table you'll also need to provide (multiple images + a mapping).
2. **The PNG file(s) themselves** - at minimum an idle-state image; a distinct speaking-state image is optional (the glow/rise/scale animation in Task 20 can apply to a single image). Transparent background, roughly square, and per the confirmed visual direction: framed so the **bottom** of the image sits at the window's top edge with no gap and renders *behind* the window (so the window's edge clips the bottom portion - "peeking out from behind the window").
3. Where to place them: `client/src/renderer/src/assets/avatars/` (created in the next task once the files exist).

- [ ] **Step 1: Confirm the above with the user before proceeding to Task 20.**

---

### Task 20: Speaking-state CSS animation (Discord-avatar mode)

**Files:**
- Modify: `client/src/renderer/src/SpeakerStrip.jsx`
- Create: `client/src/renderer/src/SpeakerStrip.css`

- [ ] **Step 1: Add the stylesheet**

```css
/* client/src/renderer/src/SpeakerStrip.css */
.speaker-strip {
  display: flex;
  gap: 8px;
}

.speaker-icon {
  border-radius: 50%;
  transform: translateY(0) scale(1);
  transition: transform 150ms ease-out, filter 150ms ease-out;
}

.speaker-icon--discord {
  margin-top: -12px; /* floats above the window's top edge */
  filter: drop-shadow(0 4px 4px rgba(0, 0, 0, 0.4));
  opacity: 1;
  z-index: 1; /* explicit - renders in front of window content, the opposite of custom-image mode's z-index: -1 (Task 21) */
  position: relative; /* z-index has no effect without a positioning context; this establishes one without affecting layout */
}

.speaker-icon--speaking {
  transform: translateY(-4px) scale(1.08);
  filter: drop-shadow(0 6px 8px rgba(255, 255, 255, 0.6)) drop-shadow(0 0 12px rgba(88, 166, 255, 0.8));
}
```

Only `transform` and `filter`/`opacity` change between states - no layout-affecting properties, per the Global Constraints GPU-compositor requirement.

- [ ] **Step 2: Update `SpeakerStrip.jsx` to use the classes and accept `avatarMode`**

```jsx
// client/src/renderer/src/SpeakerStrip.jsx
import './SpeakerStrip.css';

export default function SpeakerStrip({ roster, speakingIds, avatarMode }) {
  return (
    <div className="speaker-strip">
      {roster.map((member) => (
        <img
          key={member.speakerId}
          src={member.avatarURL}
          alt={member.username}
          width={48}
          height={48}
          className={[
            'speaker-icon',
            avatarMode === 'discord' ? 'speaker-icon--discord' : 'speaker-icon--custom',
            speakingIds.has(member.speakerId) ? 'speaker-icon--speaking' : '',
          ].filter(Boolean).join(' ')}
        />
      ))}
    </div>
  );
}
```

Pass `avatarMode` down from `ChatView.jsx` (fetch it once via `window.api.getSettings()` on mount, alongside the existing `useEffect`).

- [ ] **Step 3: Manual verify**

With discord-avatar mode selected in Settings, speak in the tracked channel - confirm the corresponding icon rises/glows smoothly with no layout jump, and returns to baseline on silence (no distinct third "cooldown" state, per the design doc). Also confirm the icons visibly render **in front of** the window's own content near the top edge (drag another window partially over that area if it's ambiguous on your desktop background) - this is the `z-index: 1` rule above, the intentional opposite of custom-image mode's `z-index: -1` in Task 21.

- [ ] **Step 4: Commit**

```bash
git add client/src/renderer/src/SpeakerStrip.jsx client/src/renderer/src/SpeakerStrip.css client/src/renderer/src/ChatView.jsx
git commit -m "feat(client): speaking-state animation for discord-avatar mode"
```

---

### Task 21: Custom-image mode rendering + avatar-mode toggle

**Files:**
- Modify: `client/src/renderer/src/SpeakerStrip.jsx`
- Modify: `client/src/renderer/src/SpeakerStrip.css`
- Copy in: the PNG(s) from Task 19 into `client/src/renderer/src/assets/avatars/`

- [ ] **Step 1: Add the custom-mode stylesheet rules**

```css
/* append to SpeakerStrip.css */
.speaker-icon--custom {
  margin-top: 0; /* no gap - clipped by the window's top edge */
  z-index: -1; /* renders behind the window content */
}
```

- [ ] **Step 2: Wire the image source by mode**

If Task 19 confirmed a **single shared image** for all speakers:

```jsx
import customAvatar from './assets/avatars/character.png';
// ...
src={avatarMode === 'discord' ? member.avatarURL : customAvatar}
```

If Task 19 confirmed **per-user images**, replace with a lookup keyed by `member.speakerId`, falling back to a default image for unmapped users - the exact mapping depends on what was provided in Task 19; do not fabricate a mapping here.

- [ ] **Step 3: Confirm the Settings toggle (added in Task 14's `LauncherView`) actually reaches `SpeakerStrip`**

`ChatView.jsx` already fetches `avatarMode` via `window.api.getSettings()` - confirm changing it in `LauncherView` (while the chat window is closed) is reflected next time the chat window opens. Live-toggling while the chat window is already open is not required by the design doc; skip it unless trivial.

- [ ] **Step 4: Manual verify against the confirmed mockup direction**

Switch to custom-image mode in Settings, reopen the chat window - confirm the character image appears to "peek out" from behind the window's top edge with no gap, and the same glow/rise/scale speaking animation applies without a layout jump.

- [ ] **Step 5: Commit**

```bash
git add client/src/renderer/src/SpeakerStrip.jsx client/src/renderer/src/SpeakerStrip.css client/src/renderer/src/assets/
git commit -m "feat(client): custom-image avatar mode rendering"
```

---

## Part 15 - Error handling & reconnect

### Task 22: `backoff.js` - pure exponential backoff

**Files:**
- Create: `client/src/main/backoff.js`
- Create: `client/src/main/backoff.test.js`

**Interfaces:**
- Produces: `export function nextDelay(attempt: number): number` (milliseconds)

- [ ] **Step 1: Write the failing test**

```js
// client/src/main/backoff.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDelay } from './backoff.js';

test('grows exponentially with a base of 500ms', () => {
  assert.equal(nextDelay(0), 500);
  assert.equal(nextDelay(1), 1000);
  assert.equal(nextDelay(2), 2000);
  assert.equal(nextDelay(3), 4000);
});

test('caps at 30 seconds', () => {
  assert.equal(nextDelay(10), 30000);
  assert.equal(nextDelay(100), 30000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/main/backoff.test.js`
Expected: FAIL - `Cannot find module './backoff.js'`

- [ ] **Step 3: Write the implementation**

```js
// client/src/main/backoff.js
const BASE_MS = 500;
const MAX_MS = 30000;

export function nextDelay(attempt) {
  return Math.min(BASE_MS * 2 ** attempt, MAX_MS);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/main/backoff.test.js`
Expected: PASS, 2/2 tests

- [ ] **Step 5: Commit**

```bash
git add client/src/main/backoff.js client/src/main/backoff.test.js
git commit -m "feat(client): add exponential backoff calculator"
```

---

### Task 23: Auth-vs-network-blip classification and reconnect wiring

**Files:**
- Modify: `client/src/main/wsClient.js`
- Modify: `client/src/main/wsClient.test.js`
- Modify: `client/src/main/index.js`

**Interfaces:**
- Consumes: `nextDelay` (Task 22)
- Produces: `wsClient` now auto-reconnects on non-auth closes and emits `'auth-failed'` (terminal, no reconnect) on auth-specific closes

- [ ] **Step 1: Write the failing test**

```js
// append to client/src/main/wsClient.test.js
test('emits auth-failed (not close-and-reconnect) for auth-specific close codes', async () => {
  const { wss, port } = await startFakeGateway((ws) => ws.close(4001, 'not in voice channel'));
  const client = createWsClient({ serverAddress: `localhost:${port}`, token: 'tok' });
  const reason = await new Promise((resolve) => client.on('auth-failed', resolve));
  assert.equal(reason, 'not in voice channel');
  wss.close();
});

test('reconnects automatically after a non-auth close', async () => {
  let connectionCount = 0;
  const { wss, port } = await startFakeGateway((ws, msg) => {
    if (msg.type === 'auth') {
      connectionCount += 1;
      if (connectionCount === 1) ws.close(1006); // simulate a network blip, not an auth failure
      else ws.send(JSON.stringify({ type: 'roster', members: [] }));
    }
  });
  const client = createWsClient({ serverAddress: `localhost:${port}`, token: 'tok', reconnectBaseDelayMs: 10 });
  await new Promise((resolve) => client.on('roster', resolve)); // only fires after the 2nd connection succeeds
  assert.ok(connectionCount >= 2);
  client.close();
  wss.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/main/wsClient.test.js`
Expected: FAIL - no `auth-failed` event, and the reconnect test times out (single connection attempt only)

- [ ] **Step 3: Implement classification + reconnect in `wsClient.js`**

```js
// client/src/main/wsClient.js - full replacement
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { nextDelay } from './backoff.js';

const AUTH_CLOSE_CODES = new Set([4001, 4002, 4003, 4008]);

export function createWsClient({ serverAddress, token, reconnectBaseDelayMs }) {
  const emitter = new EventEmitter();
  let attempt = 0;
  let closedByCaller = false;
  let socket = null;

  function connect() {
    socket = new WebSocket(`ws://${serverAddress}/`);

    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'auth', token }));
      attempt = 0;
      emitter.emit('open');
    });

    socket.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === 'roster') emitter.emit('roster', msg.members);
      else if (msg.type === 'speaking') emitter.emit('speaking', { speakerId: msg.speakerId, isSpeaking: msg.isSpeaking });
      else if (msg.type === 'transcript') emitter.emit('transcript', msg);
    });

    socket.on('close', (code, reasonBuf) => {
      const reason = reasonBuf.toString();
      emitter.emit('close', code, reason);
      if (closedByCaller) return;
      if (AUTH_CLOSE_CODES.has(code)) {
        emitter.emit('auth-failed', reason);
        return;
      }
      const delay = reconnectBaseDelayMs !== undefined
        ? Math.min(reconnectBaseDelayMs * 2 ** attempt, 30000)
        : nextDelay(attempt);
      attempt += 1;
      setTimeout(connect, delay);
    });
  }

  connect();

  emitter.close = () => {
    closedByCaller = true;
    socket.close();
  };
  return emitter;
}
```

(`reconnectBaseDelayMs` is a test-only override so the reconnect test doesn't wait 500ms+ for real; production callers omit it and get `nextDelay`'s real schedule.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/main/wsClient.test.js`
Expected: PASS, 4/4 tests

- [ ] **Step 5: Update `client/src/main/index.js`'s `wsClient.on('close', ...)` handler**

Replace the Task 16 version - reconnection is now automatic inside `wsClient`, so main needs to react to the terminal `auth-failed` case, and distinguish "still retrying" from "retried repeatedly and it's probably not coming back" (`electron-client-design.md` §5 wants the latter to show the configured address with a way back to Settings, not an indefinite silent spinner):

```js
const UNREACHABLE_THRESHOLD = 3;
let consecutiveFailures = 0;

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
```

This replaces both the `wsClient.on('open', ...)` and `wsClient.on('close', ...)` handlers originally written in Task 16 Step 1 - remove those two, keep the rest of `startWsClient()` (the `roster`/`speaking`/`transcript` handlers) unchanged.

Add one more preload/main pair so the "unreachable" UI (Task 24) can jump back to Settings: an IPC handler that restores the launcher window and tells it to open the Settings panel.

```js
// client/src/main/index.js - add
ipcMain.handle('focus-launcher-settings', () => {
  if (launcherWindow) {
    if (launcherWindow.isMinimized()) launcherWindow.restore();
    launcherWindow.focus();
    launcherWindow.webContents.send('open-settings');
  }
});
```

```js
// client/src/preload/index.js - add
focusLauncherSettings: () => ipcRenderer.invoke('focus-launcher-settings'),
onOpenSettings: (callback) => ipcRenderer.on('open-settings', () => callback()),
```

- [ ] **Step 6: Commit**

```bash
git add client/src/main/wsClient.js client/src/main/wsClient.test.js client/src/main/index.js client/src/preload/index.js
git commit -m "feat(client): reconnect with backoff on network blips, terminal state on auth failure"
```

---

### Task 24: Error-state UI for all `electron-client-design.md` §5 states

**Files:**
- Modify: `client/src/renderer/src/LauncherView.jsx`
- Modify: `client/src/renderer/src/ChatView.jsx`
- Modify: `client/src/preload/index.js` (expose `onConnectionState`)

**Interfaces:**
- Consumes: `window.api.focusLauncherSettings`/`window.api.onOpenSettings` (added in Task 23 Step 5) and `window.api.logout` (added in Task 16 Step 3)

- [ ] **Step 1: Expose the connection-state subscription**

```js
// client/src/preload/index.js - add
onConnectionState: (callback) => ipcRenderer.on('ws-connection-state', (_e, state) => callback(state)),
```

- [ ] **Step 2: `LauncherView.jsx` - network failure during login, logout button, Settings deep-link from the chat window**

("OAuth denied" is already fully handled by Task 14's `onAuthError` listener and Retry button - nothing further needed here for that state.)

```jsx
// LauncherView.jsx - extend the existing component
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
```

Add a **Log out** button (only meaningful once logged in), and listen for the `open-settings` IPC message so the chat window's "unreachable - edit in Settings" action (Step 3 below) can jump back here and pop the Settings panel open:

```jsx
// LauncherView.jsx - add to the existing useEffect
window.api.onOpenSettings(() => setShowSettings(true));
```

```jsx
// LauncherView.jsx - add near the Start Chat Window button
{settings.hasSessionToken && (
  <button onClick={() => window.api.logout().then(() => window.api.getSettings().then(setSettings))}>
    Log out
  </button>
)}
```

- [ ] **Step 3: `ChatView.jsx` - WS rejected (not in voice channel), token expired, reconnecting, unreachable**

```jsx
// ChatView.jsx - add near the top of the component
const [connectionState, setConnectionState] = useState({ status: 'connected' });
const [settings, setSettings] = useState(null);

useEffect(() => {
  window.api.getSettings().then(setSettings);
  window.api.onConnectionState(setConnectionState);
}, []);

// in the render, before the SpeakerStrip/MessageLog:
if (connectionState.status === 'auth-failed' && connectionState.reason === 'not in voice channel') {
  return (
    <div>
      <p>You need to be in the voice channel being captioned.</p>
      <button onClick={() => window.api.startChatWindow()}>Retry</button>
    </div>
  );
}
if (connectionState.status === 'auth-failed') {
  return (
    <div>
      <p>Your session expired - please log in again.</p>
      <button
        disabled={!settings}
        onClick={() => settings && window.api.openLogin(settings.serverAddress)}
      >
        Log in
      </button>
    </div>
  );
}
if (connectionState.status === 'unreachable') {
  return (
    <div>
      <p>Can't reach {connectionState.serverAddress} - still retrying in the background.</p>
      <button onClick={() => window.api.focusLauncherSettings()}>Edit server address in Settings</button>
    </div>
  );
}
if (connectionState.status === 'reconnecting') {
  return <p>Reconnecting…</p>;
}
```

(`settings` here is `ChatView`'s own local copy, fetched independently from `LauncherView`'s - both call the same `window.api.getSettings()`, which is fine since it's a cheap IPC round trip and the two windows don't share React state. If Task 20 already added a `settings`/`avatarMode` fetch to `ChatView` for the avatar-mode prop, reuse that same state variable here instead of adding a second one.)

"Server unreachable" while a chat window is already open shows `reconnecting` for the first couple of attempts (matching the design's "auto-reconnect with backoff" requirement - don't interrupt the user for a one-off blip), then escalates to the distinct `unreachable` state above once `wsClient`'s consecutive-failure count crosses the threshold set in Task 23 - satisfying §5's "connection error shown with the configured address, and a way to edit it (back to Settings)" without abandoning the backoff/retry behavior entirely.

- [ ] **Step 4: Manual verify each state, per `electron-client-design.md` §7 Part 15's own instruction**

1. **Wrong server address:** set an unreachable address in Settings, click Start Chat Window - confirm the login-open failure message (or, if a token already exists, confirm `reconnecting` shows persistently).
2. **Leaving the VC before connecting:** leave the tracked voice channel, then click Start Chat Window - confirm the "you need to be in the voice channel" message with a working Retry.
3. **Killing the bot mid-session (short outage):** with a chat window open and connected, stop the bot process, wait a couple of seconds, restart it - confirm `reconnecting` appears and clears automatically once the bot is back (roster re-fetched on reconnect, per the design's stated requirement - already satisfied since `wsClient` re-sends `auth` and the gateway always sends a fresh `roster` snapshot on successful auth, per Task 5).
4. **Killing the bot mid-session (extended outage):** same as above, but leave the bot down for longer - confirm the state escalates from `reconnecting` to `unreachable` after 3 consecutive failed attempts, showing the configured server address and a working "Edit server address in Settings" button that restores/focuses the launcher window with the Settings panel already open.
5. **Expired token:** manually shrink `SESSION_TOKEN_TTL_MS` in `auth.js` to 10 seconds temporarily, let it expire while connected, confirm the "session expired - log in again" state appears (revert the TTL change afterward - do not commit it).
6. **Logout:** while logged in with a chat window open, click **Log out** in the launcher - confirm the chat window closes, the message log and roster are cleared (verify by logging back in and confirming a fresh, empty scrollback rather than the old one reappearing), and `getSettings()` shows `hasSessionToken: false`.

- [ ] **Step 5: Commit**

```bash
git add client/src/renderer/src/LauncherView.jsx client/src/renderer/src/ChatView.jsx client/src/preload/index.js
git commit -m "feat(client): error and reconnect UI states"
```

---

## Part 16 - EC2 production hosting

### Task 25: 🔴 MANUAL INPUT NEEDED - AWS and domain access

Before this part can proceed, provide (or confirm you'll perform interactively, since these involve account credentials that shouldn't pass through an agent):

1. **An AWS account** with billing enabled and permission to launch EC2 instances, allocate an Elastic IP, and edit security groups. Expect roughly **$12–16/month** (`t4g.small` ≈ $12, Elastic IP ≈ $3.60) per `development-plan.md` §4's cost estimate.
2. **A domain name you control DNS for** (or a subdomain of one), to point at the instance's Elastic IP - required both for Let's Encrypt and because browsers block `wss://` from an `https://` page without a valid cert for that hostname.
3. Either: SSH access set up yourself (an EC2 key pair, `chmod 400`'d locally), or confirmation you'll use **AWS Systems Manager Session Manager** instead (`development-plan.md` §4.2's recommended alternative - no inbound SSH port needed).

The detailed launch/networking/DNS/server-setup steps are already fully specified in `development-plan.md` §4 - this task doesn't repeat them; it only covers the two things that document doesn't (since it predates the OAuth work): updating the OAuth redirect URI and the client's default server address for the hosted domain.

- [ ] **Step 1: Confirm the above with the user, then follow `development-plan.md` §4.1–§4.4 exactly (instance launch, networking, DNS, Caddy + pm2 setup) before continuing to Task 26.**

---

### Task 26: Update OAuth redirect URI and client defaults for the hosted domain

**Files:**
- Modify: `.env` (on the EC2 instance, not committed)
- Modify: `.env.example` (created in Task 3 - add the new variable so it's documented, not just discoverable by reading `auth.js`)
- Modify: `client/src/main/store.js`'s default, or document the Settings-screen change

- [ ] **Step 1: Register the production redirect URI**

In the Discord Developer Portal's OAuth2 tab, add a second redirect: `https://<your-subdomain>/auth/callback` (keep the `localhost:3000` one too, for continued local dev).

- [ ] **Step 2: Update `auth.js`'s `REDIRECT_URI` to be environment-driven**

```js
// auth.js - replace the hardcoded localhost REDIRECT_URI
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT_NUMBER}`;
const REDIRECT_URI = `${PUBLIC_BASE_URL}/auth/callback`;
```

Add `PUBLIC_BASE_URL=https://<your-subdomain>` to the `.env` on the EC2 instance only (leave it unset locally, where the `localhost` fallback applies). Add the same variable name (no value) to `.env.example`, with a comment: `# PUBLIC_BASE_URL - hosted-deployment only, e.g. https://captions.yourdomain.com; leave unset for local dev`.

- [ ] **Step 3: Update the client's default server address for hosted use, and switch scheme to `wss`/`https`**

`wsClient.js` currently hardcodes `ws://${serverAddress}/`. Change it to derive the scheme from whether the address looks like a bare `host:port` (local dev) or a hostname without an explicit port (hosted, assumed HTTPS):

```js
// client/src/main/wsClient.js - replace the socket URL construction
const scheme = serverAddress.includes('localhost') || /:\d+$/.test(serverAddress) ? 'ws' : 'wss';
socket = new WebSocket(`${scheme}://${serverAddress}/`);
```

Similarly, `client/src/main/index.js`'s `openLogin` handler (Task 13) builds `http://${serverAddress}/auth/login` - apply the same scheme rule there for consistency.

Update `client/src/main/store.js`'s default `serverAddress` only if you want the *out-of-the-box* client default to point at the hosted instance rather than `localhost:3000` - optional, since users can already set this in Settings.

- [ ] **Step 4: Commit**

```bash
git add auth.js .env.example client/src/main/wsClient.js client/src/main/index.js
git commit -m "feat: support hosted deployment via PUBLIC_BASE_URL and wss/https scheme selection"
```

---

### Task 27: Final end-to-end hosted verification

**Files:** none (verification-only task)

- [ ] **Step 1: Verify per `development-plan.md` §4.5, extended for OAuth**

1. Visit `https://<your-subdomain>` - confirm it responds (404 with the "use the Electron client" message is correct, per Task 9).
2. In the Electron client's Settings, set the server address to your hosted domain (no port, e.g. `captions.yourdomain.com`).
3. Click Start Chat Window with no token - confirm login opens `https://<your-subdomain>/auth/login`, completes the Discord OAuth round trip against the **production** redirect URI, and returns a token via the `discord-echo://` deep link exactly as it did locally.
4. Confirm the chat window connects over `wss://` (check devtools' Network tab, or main-process logs) and captions flow live while speaking in the tracked voice channel.
5. Restart the bot process on the EC2 instance (`pm2 restart` per `development-plan.md` §4.4) - confirm the client's `reconnecting` state appears and clears automatically once the bot comes back (Task 23's reconnect logic, now exercised against a real network hop instead of localhost).

- [ ] **Step 2: Commit** (skip - no code changes)

---

## Explicitly out of scope (per the source design docs' own non-goals)

Do not add these as part of executing this plan - they're deliberate scope boundaries stated in `electron-client-design.md` §6 and `bot-backend-design.md`, not oversights:

- Packaging, code signing, or auto-updater (`electron-builder`/`electron-updater`) - `client/` remains `npm run dev` only.
- Transparent/always-on-top/click-through window behavior and a system tray - normal windows only.
- Multi-guild / multi-session backend support - single global session throughout.
- Continuous (non-connect-time) voice-channel re-verification.
- Persisting the chat log to disk.
- **Bot-process crash/auto-rejoin.** `bot-backend-design.md` §8 lists "no crash/reconnect story" as a known limitation, not a proposed feature - neither design doc specifies what auto-rejoin should look like. Task 25's `pm2` supervisor (from `development-plan.md` §4.4) restarts the Node *process* automatically if it crashes, but does not re-run `/captions start` - that stays a manual step after a crash. If this needs closing, it's a new design decision, not something this plan silently implements.
- **The `npm audit` / `undici` vulnerabilities** (`bot-backend-design.md` §8) - left as-is, per that section's own reasoning: no discord.js release fixes them yet, forcing an upgrade would downgrade discord.js, and the exposure is low since `undici` here only talks to Discord's own API. No task in this plan touches it; revisit only once discord.js ships a fix.
