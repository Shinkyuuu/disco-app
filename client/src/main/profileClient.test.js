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
import { fetchProfile, AuthError } from './profileClient.js';

function startTestHttpServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

test('fetchProfile returns the parsed profile on success', async () => {
  const { server, port } = await startTestHttpServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ username: 'Alice' }));
  });
  const profile = await fetchProfile({ serverAddress: `localhost:${port}`, token: 'tok' });
  assert.deepEqual(profile, { username: 'Alice' });
  server.close();
});

test('fetchProfile throws AuthError on a 401', async () => {
  const { server, port } = await startTestHttpServer((req, res) => {
    res.writeHead(401);
    res.end();
  });
  await assert.rejects(() => fetchProfile({ serverAddress: `localhost:${port}`, token: 'bad' }), AuthError);
  server.close();
});

test('fetchProfile returns null for a non-auth error status (e.g. not in a tracked guild)', async () => {
  const { server, port } = await startTestHttpServer((req, res) => {
    res.writeHead(404);
    res.end();
  });
  const profile = await fetchProfile({ serverAddress: `localhost:${port}`, token: 'tok' });
  assert.equal(profile, null);
  server.close();
});

test('fetchProfile aborts a hung request instead of waiting forever', async () => {
  const { server, port } = await startTestHttpServer(() => {
    // Never respond - simulates a server that accepted the TCP connection but hangs.
  });
  await assert.rejects(() => fetchProfile({ serverAddress: `localhost:${port}`, token: 'tok', timeoutMs: 50 }));
  server.close();
});
