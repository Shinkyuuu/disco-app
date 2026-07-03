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
