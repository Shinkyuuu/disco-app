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
import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { handleAuthLogin, handleAuthCallback, handleAuthExchange, handleAuthIcon, verifySessionToken, readJsonBody } from './auth.js';
import { getLiveSessionForUser, getUserProfile, rebroadcastRosterIfLive } from './bot.js';
import { getSession } from './sessionRegistry.js';
import { avatarRegistry, ALLOWED_AVATAR_STATES, ALLOWED_AVATAR_EXTENSIONS, SPEAKING_AVATAR_TYPES, extensionsForState, AvatarValidationError, isValidHexColor } from './avatarRegistry.js';

const { PORT } = process.env;
export const PORT_NUMBER = PORT || 3000;

export const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/auth/login') return handleAuthLogin(req, res);
  if (url.pathname === '/auth/callback') return handleAuthCallback(req, res);
  if (url.pathname === '/auth/exchange') return handleAuthExchange(req, res);
  if (url.pathname === '/auth/icon.png') return handleAuthIcon(req, res);
  if (url.pathname === '/api/me') return handleMe(req, res);
  if (url.pathname === '/api/avatar/upload-url') return handleAvatarUploadUrl(req, res);
  if (url.pathname === '/api/avatar/confirm') return handleAvatarConfirm(req, res);
  if (url.pathname === '/api/avatar/clear') return handleAvatarClear(req, res);
  if (url.pathname === '/api/avatar/speaking-type') return handleAvatarSpeakingType(req, res);
  if (url.pathname === '/api/avatar/colors') return handleAvatarColors(req, res);
  if (url.pathname === '/api/avatar/me') return handleAvatarMe(req, res);
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found - use the Disco Electron client to view captions.');
});

const gatewayClients = new Map(); // ws -> { userId, guildId }
const wss = new WebSocketServer({ server: httpServer });

// Unhandled 'error' on either of these throws and kills the whole process.
httpServer.on('error', (err) => console.error('HTTP server error:', err));
wss.on('error', (err) => console.error('WebSocket server error:', err));

const AUTH_TIMEOUT_MS = 5000;

export function createAuthGate({ verifyToken, getLiveSession, getRosterSnapshot, clients, timeoutMs = AUTH_TIMEOUT_MS }) {
  return function handleConnection(ws) {
    // A client socket that dies abruptly (network drop, reset) emits 'error', not just
    // 'close'. Node throws on an unhandled 'error' event and kills the whole process -
    // every guild's session, not just this one client - so this must always be handled.
    ws.on('error', (err) => {
      console.error('Gateway client socket error:', err);
    });

    // Answers sweepHeartbeats below - true until a ping goes unanswered for a
    // full interval, at which point the connection is presumed dead and terminated.
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

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
      // guildId is captured here, once, rather than re-derived from live voice
      // state on every later lookup - a teardown notification (see
      // createSessionEndedNotifier below) needs to reach this client even
      // after their own voice-state change is what triggered the teardown,
      // by which point getLiveSession(userId) would no longer recognize them.
      clients.set(ws, { userId, guildId: liveSession.guildId });
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
  return async function handleMe(req, res) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
    const userId = token ? verifyToken(token) : null;
    if (!userId) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const profile = await getProfile(userId);
    if (!profile) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ userId, ...profile }));
  };
}

function requireBearerUserId(req, verifyToken) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;
  return token ? verifyToken(token) : null;
}

export function createAvatarUploadUrlHandler({ verifyToken, requestUploadUrl }) {
  return async function handleAvatarUploadUrl(req, res) {
    const userId = requireBearerUserId(req, verifyToken);
    if (!userId) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid body' }));
      return;
    }
    if (!ALLOWED_AVATAR_STATES.includes(body.state) || !extensionsForState(body.state).includes(body.ext)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid state or ext' }));
      return;
    }
    try {
      const result = await requestUploadUrl(userId, body.state, body.ext);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('Failed to generate avatar upload URL:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'failed to generate upload url' }));
    }
  };
}

export function createAvatarConfirmHandler({ verifyToken, confirmUpload, onAvatarChanged }) {
  return async function handleAvatarConfirm(req, res) {
    const userId = requireBearerUserId(req, verifyToken);
    if (!userId) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid body' }));
      return;
    }
    if (!ALLOWED_AVATAR_STATES.includes(body.state) || typeof body.version !== 'string' || !extensionsForState(body.state).includes(body.ext)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid state, version, or ext' }));
      return;
    }
    try {
      const avatarUrl = await confirmUpload(userId, body.state, body.version, body.ext, { fps: body.fps, frameCount: body.frameCount });
      onAvatarChanged?.(userId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ avatarUrl }));
    } catch (err) {
      if (err instanceof AvatarValidationError) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
      console.error('Failed to confirm avatar upload:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'failed to confirm avatar upload' }));
    }
  };
}

export function createAvatarClearHandler({ verifyToken, clearAvatar, onAvatarChanged }) {
  return async function handleAvatarClear(req, res) {
    const userId = requireBearerUserId(req, verifyToken);
    if (!userId) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid body' }));
      return;
    }
    if (!ALLOWED_AVATAR_STATES.includes(body.state)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid state' }));
      return;
    }
    await clearAvatar(userId, body.state);
    onAvatarChanged?.(userId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({}));
  };
}

export function createAvatarSpeakingTypeHandler({ verifyToken, setActiveSpeakingType, onAvatarChanged }) {
  return async function handleAvatarSpeakingType(req, res) {
    const userId = requireBearerUserId(req, verifyToken);
    if (!userId) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid body' }));
      return;
    }
    if (!SPEAKING_AVATAR_TYPES.includes(body.type)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid type' }));
      return;
    }
    try {
      const speakingURL = await setActiveSpeakingType(userId, body.type);
      onAvatarChanged?.(userId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ speakingURL }));
    } catch (err) {
      if (err instanceof AvatarValidationError) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
      console.error('Failed to set active speaking avatar type:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'failed to set active speaking avatar type' }));
    }
  };
}

export function createAvatarColorsHandler({ verifyToken, setProfileColors, onAvatarChanged }) {
  return async function handleAvatarColors(req, res) {
    const userId = requireBearerUserId(req, verifyToken);
    if (!userId) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid body' }));
      return;
    }
    if (!isValidHexColor(body.usernameColor) || !isValidHexColor(body.chatColor)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid usernameColor or chatColor' }));
      return;
    }
    try {
      const colors = await setProfileColors(userId, { usernameColor: body.usernameColor, chatColor: body.chatColor });
      onAvatarChanged?.(userId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(colors));
    } catch (err) {
      if (err instanceof AvatarValidationError) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
      console.error('Failed to set profile colors:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'failed to set profile colors' }));
    }
  };
}

export function createAvatarMeHandler({ verifyToken, resolveAvatarUrls }) {
  return async function handleAvatarMe(req, res) {
    const userId = requireBearerUserId(req, verifyToken);
    if (!userId) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    const urls = await resolveAvatarUrls(userId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ silentURL: urls?.silentURL ?? null, speakingURL: urls?.speakingURL ?? null }));
  };
}

const handleMe = createMeHandler({ verifyToken: verifySessionToken, getProfile: getUserProfile });
const handleAvatarUploadUrl = createAvatarUploadUrlHandler({ verifyToken: verifySessionToken, requestUploadUrl: avatarRegistry.requestUploadUrl });
const handleAvatarConfirm = createAvatarConfirmHandler({ verifyToken: verifySessionToken, confirmUpload: avatarRegistry.confirmUpload, onAvatarChanged: rebroadcastRosterIfLive });
const handleAvatarClear = createAvatarClearHandler({ verifyToken: verifySessionToken, clearAvatar: avatarRegistry.clearAvatar, onAvatarChanged: rebroadcastRosterIfLive });
const handleAvatarSpeakingType = createAvatarSpeakingTypeHandler({ verifyToken: verifySessionToken, setActiveSpeakingType: avatarRegistry.setActiveSpeakingType, onAvatarChanged: rebroadcastRosterIfLive });
const handleAvatarColors = createAvatarColorsHandler({ verifyToken: verifySessionToken, setProfileColors: avatarRegistry.setProfileColors, onAvatarChanged: rebroadcastRosterIfLive });
const handleAvatarMe = createAvatarMeHandler({ verifyToken: verifySessionToken, resolveAvatarUrls: avatarRegistry.resolveAvatarUrls });

export function createBroadcaster({ getLiveSession, clients }) {
  return function broadcastToSession(guildId, payload) {
    const message = JSON.stringify({ ...payload, guildId });
    for (const [ws, client] of clients) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const liveSession = getLiveSession(client.userId);
      if (liveSession?.guildId === guildId) ws.send(message);
    }
  };
}

// Unlike broadcastToSession above (roster/speaking/transcript - which must
// stop reaching a client the instant they leave the channel, for privacy),
// a session-end teardown notice needs to reach every client who WAS
// authorized for this guild's session, including whoever's own departure
// just ended it - by the time stopCaptions runs, Discord's voice-state
// cache already reflects them as no longer in the channel, so
// getLiveSession(userId) would incorrectly exclude exactly that client.
// Uses each client's guildId as captured once at auth time instead.
export function createSessionEndedNotifier({ clients }) {
  return function notifySessionEnded(guildId) {
    const message = JSON.stringify({ type: 'session-ended', guildId });
    for (const [ws, client] of clients) {
      if (client.guildId !== guildId) continue;
      if (ws.readyState !== WebSocket.OPEN) continue;
      ws.send(message);
    }
  };
}

function getRosterSnapshot(guildId) {
  return getSession(guildId)?.roster ?? [];
}

// Without this, a connection proxied through the Cloudflare tunnel that goes
// idle (no captions/roster changes for a few minutes, which is a normal lull
// in conversation) carries zero traffic in either direction - the tunnel's
// edge silently drops it, and the client only notices once it tries to send
// or the OS eventually reports the dead socket, surfacing as a spurious
// "Reconnecting..." banner. A periodic ping keeps traffic flowing so the
// tunnel never sees the connection as idle, and also lets the server detect
// and clean up a truly dead client instead of leaving it in `clients` forever.
export const HEARTBEAT_INTERVAL_MS = 20000;

export function sweepHeartbeats(clients) {
  for (const ws of clients.keys()) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}

export function createHeartbeat({ clients, intervalMs = HEARTBEAT_INTERVAL_MS }) {
  return setInterval(() => sweepHeartbeats(clients), intervalMs);
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

export const notifySessionEnded = createSessionEndedNotifier({ clients: gatewayClients });

const heartbeatInterval = createHeartbeat({ clients: gatewayClients });
// Doesn't keep the process alive on its own - the listening httpServer already
// does that once startGateway() runs. Without this, merely importing this
// module (e.g. from tests that never call startGateway()) leaves a live timer
// with nothing else running, and the process never exits.
heartbeatInterval.unref();

export function startGateway() {
  httpServer.listen(PORT_NUMBER);
}
