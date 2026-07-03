import 'dotenv/config';
import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { handleAuthLogin, handleAuthCallback, verifySessionToken } from './auth.js';
import { isUserInTrackedChannel, getRoster } from './bot.js';

const { PORT } = process.env;
export const PORT_NUMBER = PORT || 3000;

export const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/auth/login') return handleAuthLogin(req, res);
  if (url.pathname === '/auth/callback') return handleAuthCallback(req, res);
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found — use the discord-echo Electron client to view captions.');
});

const gatewayClients = new Set();
const wss = new WebSocketServer({ server: httpServer });

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

export function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of gatewayClients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

export function startGateway() {
  httpServer.listen(PORT_NUMBER, () => {
    console.log(`Caption overlay available at http://localhost:${PORT_NUMBER}`);
  });
}
