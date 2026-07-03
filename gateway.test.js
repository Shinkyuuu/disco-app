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
