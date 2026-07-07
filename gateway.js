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
