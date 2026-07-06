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
