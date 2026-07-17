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
import net from 'node:net';
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

test('emits auth-failed (not close-and-reconnect) with both the reason and numeric close code', async () => {
  const { wss, port } = await startFakeGateway((ws) => ws.close(4001, 'not in voice channel'));
  const client = createWsClient({ serverAddress: `localhost:${port}`, token: 'tok' });
  const [reason, code] = await new Promise((resolve) => client.on('auth-failed', (r, c) => resolve([r, c])));
  assert.equal(reason, 'not in voice channel');
  assert.equal(code, 4001);
  wss.close();
});

test('reconnects automatically after a non-auth close', async () => {
  let connectionCount = 0;
  const { wss, port } = await startFakeGateway((ws, msg) => {
    if (msg.type === 'auth') {
      connectionCount += 1;
      // Simulate a network blip, not an auth failure: terminate() drops the TCP
      // connection without a close frame, so the client observes code 1006.
      // (1006 is reserved and can't be passed to ws.close() directly.)
      if (connectionCount === 1) ws.terminate();
      else ws.send(JSON.stringify({ type: 'roster', members: [] }));
    }
  });
  const client = createWsClient({ serverAddress: `localhost:${port}`, token: 'tok', reconnectBaseDelayMs: 10 });
  await new Promise((resolve) => client.on('roster', resolve)); // only fires after the 2nd connection succeeds
  assert.ok(connectionCount >= 2);
  client.close();
  wss.close();
});

test('close() cancels a pending reconnect timer so no zombie reconnection happens', async () => {
  let connectionCount = 0;
  const { wss, port } = await startFakeGateway((ws, msg) => {
    if (msg.type === 'auth') {
      connectionCount += 1;
      ws.terminate(); // always drop - only the first connection should ever happen
    }
  });
  const client = createWsClient({ serverAddress: `localhost:${port}`, token: 'tok', reconnectBaseDelayMs: 20 });
  await new Promise((resolve) => client.on('close', resolve)); // first disconnect - reconnect timer now pending
  client.close();
  await new Promise((resolve) => setTimeout(resolve, 100)); // well past the pending reconnect delay
  assert.equal(connectionCount, 1);
  wss.close();
});

test('does not crash the process on a non-101 handshake response (e.g. a 502 from a proxy)', async () => {
  // A plain HTTP server that never upgrades the connection - ws sees a non-101
  // response and emits 'error' ("Unexpected server response: 502"), which with
  // no listener is an uncaught exception that kills the whole process.
  const server = http.createServer((req, res) => {
    res.writeHead(502);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const client = createWsClient({ serverAddress: `localhost:${port}`, token: 'tok', reconnectBaseDelayMs: 10 });
  // Reaching a 'close' event at all (rather than the process crashing first)
  // is the assertion - a failed handshake surfaces as an abnormal closure.
  const [code] = await new Promise((resolve) => client.on('close', (c, r) => resolve([c, r])));
  assert.equal(code, 1006);

  client.close();
  server.close();
});

test('emits session-ended when the server sends a session-ended message', async () => {
  const { wss, port } = await startFakeGateway((ws, msg) => {
    if (msg.type === 'auth') ws.send(JSON.stringify({ type: 'session-ended' }));
  });

  const client = createWsClient({ serverAddress: `localhost:${port}`, token: 'tok' });
  await new Promise((resolve) => client.on('session-ended', resolve));

  client.close();
  wss.close();
});

test('force-reconnects when the server goes completely silent for longer than the heartbeat timeout', async () => {
  let connectionCount = 0;
  const { wss, port } = await startFakeGateway((ws, msg) => {
    if (msg.type !== 'auth') return;
    connectionCount += 1;
    // First connection says nothing at all after auth - no roster, no ping - so
    // the client's watchdog is the only thing that can ever move this forward.
    if (connectionCount === 2) ws.send(JSON.stringify({ type: 'roster', members: [] }));
  });
  const client = createWsClient({
    serverAddress: `localhost:${port}`,
    token: 'tok',
    reconnectBaseDelayMs: 10,
    heartbeatTimeoutMs: 30,
  });
  await new Promise((resolve) => client.on('roster', resolve));
  assert.ok(connectionCount >= 2);
  client.close();
  wss.close();
});

test('does not force-reconnect while the server keeps sending pings within the heartbeat timeout', async () => {
  let connectionCount = 0;
  let pingTimer;
  const { wss, port } = await startFakeGateway((ws, msg) => {
    if (msg.type !== 'auth') return;
    connectionCount += 1;
    pingTimer = setInterval(() => ws.ping(), 15);
  });
  const client = createWsClient({
    serverAddress: `localhost:${port}`,
    token: 'tok',
    reconnectBaseDelayMs: 10,
    heartbeatTimeoutMs: 50,
  });
  await new Promise((resolve) => setTimeout(resolve, 150)); // several ping intervals, past one heartbeat window
  assert.equal(connectionCount, 1);
  clearInterval(pingTimer);
  client.close();
  wss.close();
});

test('force-reconnects if the handshake itself hangs (TCP connects, but no open/error/close ever fires)', async () => {
  // A tunnel/proxy that silently swallows the HTTP Upgrade exchange looks exactly
  // like this: the TCP connection succeeds, but nothing ever comes back - no 101
  // response, no error, no close. Without a connect-phase watchdog this attempt
  // would hang forever.
  const server = net.createServer((socket) => {
    server.__sockets = server.__sockets || [];
    server.__sockets.push(socket); // never write/end - the handshake just hangs
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  const client = createWsClient({
    serverAddress: `localhost:${port}`,
    token: 'tok',
    reconnectBaseDelayMs: 10,
    heartbeatTimeoutMs: 30,
  });
  await new Promise((resolve) => client.on('close', resolve));

  client.close();
  for (const socket of server.__sockets || []) socket.destroy();
  server.close();
});

test('close() stops the heartbeat watchdog so it does not force a reconnect after an intentional close', async () => {
  let connectionCount = 0;
  const { wss, port } = await startFakeGateway((ws, msg) => {
    if (msg.type === 'auth') connectionCount += 1; // never sends anything back
  });
  const client = createWsClient({
    serverAddress: `localhost:${port}`,
    token: 'tok',
    reconnectBaseDelayMs: 20,
    heartbeatTimeoutMs: 30,
  });
  await new Promise((resolve) => setTimeout(resolve, 5)); // let the connection open
  client.close();
  await new Promise((resolve) => setTimeout(resolve, 100)); // well past heartbeatTimeoutMs and reconnectBaseDelayMs
  assert.equal(connectionCount, 1);
  wss.close();
});
