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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createAuthGate, createMeHandler, createBroadcaster, createSessionEndedNotifier, createAvatarUploadUrlHandler, createAvatarConfirmHandler, createAvatarClearHandler, createAvatarMeHandler, createAvatarColorsHandler } from './gateway.js';
import { AvatarValidationError } from './avatarRegistry.js';

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

test('POST /api/avatar/upload-url returns 200 with uploadUrl+version for a valid request', async () => {
  const handler = createAvatarUploadUrlHandler({
    verifyToken: (token) => (token === 'good-token' ? 'user-1' : null),
    requestUploadUrl: async (userId, state, ext) => ({ uploadUrl: `https://s3/${userId}/${state}.${ext}`, version: 'v1' }),
  });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/avatar/upload-url`, {
    method: 'POST',
    headers: { Authorization: 'Bearer good-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'silent', ext: 'png' }),
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.uploadUrl, 'https://s3/user-1/silent.png');
  assert.equal(body.version, 'v1');
  server.close();
});

test('POST /api/avatar/upload-url returns 401 without a valid token', async () => {
  const handler = createAvatarUploadUrlHandler({ verifyToken: () => null, requestUploadUrl: async () => ({}) });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/avatar/upload-url`, {
    method: 'POST',
    body: JSON.stringify({ state: 'silent', ext: 'png' }),
  });
  assert.equal(res.status, 401);
  server.close();
});

test('POST /api/avatar/upload-url returns 400 for an invalid state or ext', async () => {
  const handler = createAvatarUploadUrlHandler({ verifyToken: () => 'user-1', requestUploadUrl: async () => ({}) });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/avatar/upload-url`, {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'bogus', ext: 'png' }),
  });
  assert.equal(res.status, 400);
  server.close();
});

test('POST /api/avatar/confirm returns 200 with the resolved avatarUrl and notifies onAvatarChanged', async () => {
  const changed = [];
  const handler = createAvatarConfirmHandler({
    verifyToken: () => 'user-1',
    confirmUpload: async (userId, state, version, ext) => `https://cdn/${userId}/${version}-${state}.${ext}`,
    onAvatarChanged: (userId) => changed.push(userId),
  });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/avatar/confirm`, {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'silent', version: 'v1', ext: 'png' }),
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.avatarUrl, 'https://cdn/user-1/v1-silent.png');
  assert.deepEqual(changed, ['user-1']);
  server.close();
});

test('POST /api/avatar/confirm returns 400 when confirmUpload rejects with a validation error (e.g. object not found), and does not notify onAvatarChanged', async () => {
  const changed = [];
  const handler = createAvatarConfirmHandler({
    verifyToken: () => 'user-1',
    confirmUpload: async () => { throw new AvatarValidationError('Uploaded object not found'); },
    onAvatarChanged: (userId) => changed.push(userId),
  });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/avatar/confirm`, {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'silent', version: 'v1', ext: 'png' }),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(changed, []);
  server.close();
});

test('POST /api/avatar/confirm returns 401 without a valid token, and does not notify onAvatarChanged', async () => {
  const changed = [];
  const handler = createAvatarConfirmHandler({
    verifyToken: () => null,
    confirmUpload: async () => 'https://cdn/x',
    onAvatarChanged: (userId) => changed.push(userId),
  });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/avatar/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'silent', version: 'v1', ext: 'png' }),
  });
  assert.equal(res.status, 401);
  assert.deepEqual(changed, []);
  server.close();
});

test('POST /api/avatar/confirm returns 500 without leaking the error message when confirmUpload rejects with an unexpected error', async () => {
  const handler = createAvatarConfirmHandler({
    verifyToken: () => 'user-1',
    confirmUpload: async () => { throw new Error('network timeout'); },
  });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/avatar/confirm`, {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'silent', version: 'v1', ext: 'png' }),
  });
  const bodyText = await res.text();
  assert.equal(res.status, 500);
  assert.ok(!bodyText.includes('network timeout'));
  server.close();
});

test('POST /api/avatar/clear returns 200 on success and notifies onAvatarChanged', async () => {
  const cleared = [];
  const changed = [];
  const handler = createAvatarClearHandler({
    verifyToken: () => 'user-1',
    clearAvatar: async (userId, state) => { cleared.push([userId, state]); },
    onAvatarChanged: (userId) => changed.push(userId),
  });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/avatar/clear`, {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'speaking' }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(cleared, [['user-1', 'speaking']]);
  assert.deepEqual(changed, ['user-1']);
  server.close();
});

test('POST /api/avatar/clear returns 401 without a valid token, and does not notify onAvatarChanged', async () => {
  const changed = [];
  const handler = createAvatarClearHandler({
    verifyToken: () => null,
    clearAvatar: async () => {},
    onAvatarChanged: (userId) => changed.push(userId),
  });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/avatar/clear`, {
    method: 'POST',
    body: JSON.stringify({ state: 'silent' }),
  });
  assert.equal(res.status, 401);
  assert.deepEqual(changed, []);
  server.close();
});

test('GET /api/avatar/me returns 200 with silentURL/speakingURL for a valid token', async () => {
  const handler = createAvatarMeHandler({
    verifyToken: (token) => (token === 'good-token' ? 'user-1' : null),
    resolveAvatarUrls: async (userId) =>
      userId === 'user-1' ? { silentURL: 'https://cdn/silent.png', speakingURL: 'https://cdn/speaking.png' } : null,
  });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/avatar/me`, { headers: { Authorization: 'Bearer good-token' } });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body, { silentURL: 'https://cdn/silent.png', speakingURL: 'https://cdn/speaking.png' });
  server.close();
});

test('GET /api/avatar/me returns 200 with nulls when no avatar has been set', async () => {
  const handler = createAvatarMeHandler({ verifyToken: () => 'user-1', resolveAvatarUrls: async () => null });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/avatar/me`, { headers: { Authorization: 'Bearer tok' } });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body, { silentURL: null, speakingURL: null });
  server.close();
});

test('GET /api/avatar/me returns 401 with no Authorization header', async () => {
  const handler = createAvatarMeHandler({ verifyToken: () => 'user-1', resolveAvatarUrls: async () => null });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/avatar/me`);
  assert.equal(res.status, 401);
  server.close();
});

test('GET /api/avatar/me returns 401 for an invalid token', async () => {
  const handler = createAvatarMeHandler({ verifyToken: () => null, resolveAvatarUrls: async () => null });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/avatar/me`, { headers: { Authorization: 'Bearer bad-token' } });
  assert.equal(res.status, 401);
  server.close();
});

test('POST /api/avatar/colors returns 200 with the written colors and notifies onAvatarChanged', async () => {
  const changed = [];
  const handler = createAvatarColorsHandler({
    verifyToken: () => 'user-1',
    setProfileColors: async (userId, colors) => ({ ...colors }),
    onAvatarChanged: (userId) => changed.push(userId),
  });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/avatar/colors`, {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernameColor: '#ff0000', chatColor: null }),
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(body, { usernameColor: '#ff0000', chatColor: null });
  assert.deepEqual(changed, ['user-1']);
  server.close();
});

test('POST /api/avatar/colors returns 400 for a malformed color and does not notify onAvatarChanged', async () => {
  const changed = [];
  const handler = createAvatarColorsHandler({
    verifyToken: () => 'user-1',
    setProfileColors: async () => { throw new Error('should not be called'); },
    onAvatarChanged: (userId) => changed.push(userId),
  });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/avatar/colors`, {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernameColor: 'not-a-color', chatColor: null }),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(changed, []);
  server.close();
});

test('POST /api/avatar/colors returns 401 without a valid token, and does not notify onAvatarChanged', async () => {
  const changed = [];
  const handler = createAvatarColorsHandler({
    verifyToken: () => null,
    setProfileColors: async () => ({}),
    onAvatarChanged: (userId) => changed.push(userId),
  });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/avatar/colors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernameColor: '#ff0000', chatColor: null }),
  });
  assert.equal(res.status, 401);
  assert.deepEqual(changed, []);
  server.close();
});

test('POST /api/avatar/colors returns 400 when setProfileColors rejects with a validation error', async () => {
  const handler = createAvatarColorsHandler({
    verifyToken: () => 'user-1',
    setProfileColors: async () => { throw new AvatarValidationError('Invalid color'); },
  });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/avatar/colors`, {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernameColor: '#ff0000', chatColor: null }),
  });
  assert.equal(res.status, 400);
  server.close();
});

test('POST /api/avatar/colors returns 500 without leaking the error message on an unexpected error', async () => {
  const handler = createAvatarColorsHandler({
    verifyToken: () => 'user-1',
    setProfileColors: async () => { throw new Error('network timeout'); },
  });
  const { server, port } = await startTestHttpServer(handler);
  const res = await fetch(`http://localhost:${port}/api/avatar/colors`, {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernameColor: '#ff0000', chatColor: null }),
  });
  const bodyText = await res.text();
  assert.equal(res.status, 500);
  assert.ok(!bodyText.includes('network timeout'));
  server.close();
});

test('broadcastToSession delivers only to clients whose live session matches the target guild', () => {
  const sent = [];
  const wsA = { readyState: WebSocket.OPEN, send: (msg) => sent.push(['A', JSON.parse(msg)]) };
  const wsB = { readyState: WebSocket.OPEN, send: (msg) => sent.push(['B', JSON.parse(msg)]) };
  const clients = new Map([[wsA, { userId: 'user-a', guildId: 'guild-1' }], [wsB, { userId: 'user-b', guildId: 'guild-2' }]]);
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
  const clients = new Map([[wsA, { userId: 'user-a', guildId: 'guild-1' }]]);
  const broadcastToSession = createBroadcaster({ getLiveSession: () => null, clients });

  broadcastToSession('guild-1', { type: 'roster', members: [] });

  assert.equal(sent.length, 0);
});

test('broadcastToSession skips a client whose socket is not open', () => {
  const sent = [];
  const wsA = { readyState: WebSocket.CLOSING, send: (msg) => sent.push(msg) };
  const clients = new Map([[wsA, { userId: 'user-a', guildId: 'guild-1' }]]);
  const broadcastToSession = createBroadcaster({
    getLiveSession: () => ({ guildId: 'guild-1' }),
    clients,
  });

  broadcastToSession('guild-1', { type: 'roster', members: [] });

  assert.equal(sent.length, 0);
});

test('notifySessionEnded delivers to a client even though their live session no longer matches - the exact case of a user whose own departure just ended the session', () => {
  const sent = [];
  const wsA = { readyState: WebSocket.OPEN, send: (msg) => sent.push(JSON.parse(msg)) };
  // No getLiveSession dependency at all - clients is keyed by the guildId captured at
  // auth time, not re-derived from current (already-stale-by-now) voice state.
  const clients = new Map([[wsA, { userId: 'user-a', guildId: 'guild-1' }]]);
  const notifySessionEnded = createSessionEndedNotifier({ clients });

  notifySessionEnded('guild-1');

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'session-ended');
  assert.equal(sent[0].guildId, 'guild-1');
});

test('notifySessionEnded skips a client authorized for a different guild', () => {
  const sent = [];
  const wsA = { readyState: WebSocket.OPEN, send: (msg) => sent.push(msg) };
  const clients = new Map([[wsA, { userId: 'user-a', guildId: 'guild-2' }]]);
  const notifySessionEnded = createSessionEndedNotifier({ clients });

  notifySessionEnded('guild-1');

  assert.equal(sent.length, 0);
});

test('notifySessionEnded skips a client whose socket is not open', () => {
  const sent = [];
  const wsA = { readyState: WebSocket.CLOSING, send: (msg) => sent.push(msg) };
  const clients = new Map([[wsA, { userId: 'user-a', guildId: 'guild-1' }]]);
  const notifySessionEnded = createSessionEndedNotifier({ clients });

  notifySessionEnded('guild-1');

  assert.equal(sent.length, 0);
});
