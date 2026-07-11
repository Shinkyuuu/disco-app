import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
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
