import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { exchangeAuthCode, AuthExchangeError } from './authClient.js';

function startTestHttpServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

test('exchangeAuthCode returns the token and userId for a successful exchange', async () => {
  const { server, port } = await startTestHttpServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ token: 'real-token', userId: 'user-1' }));
  });
  const result = await exchangeAuthCode({ serverAddress: `localhost:${port}`, code: 'abc' });
  assert.deepEqual(result, { token: 'real-token', userId: 'user-1' });
  server.close();
});

test('exchangeAuthCode throws AuthExchangeError for a non-ok response', async () => {
  const { server, port } = await startTestHttpServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid or expired code' }));
  });
  await assert.rejects(() => exchangeAuthCode({ serverAddress: `localhost:${port}`, code: 'bad' }), AuthExchangeError);
  server.close();
});
