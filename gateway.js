import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { handleAuthLogin, handleAuthCallback } from './auth.js';

const { PORT } = process.env;
export const PORT_NUMBER = PORT || 3000;

const OVERLAY_HTML = fs.readFileSync('overlay.html');

export const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/auth/login') return handleAuthLogin(req, res);
  if (url.pathname === '/auth/callback') return handleAuthCallback(req, res);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(OVERLAY_HTML);
});

const gatewayClients = new Set();
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  gatewayClients.add(ws);
  ws.on('close', () => gatewayClients.delete(ws));
});

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
