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
import { AvatarUploadError, requestAvatarUploadUrl, confirmAvatarUpload, clearBroadcastAvatar, uploadFileToPresignedUrl, getBroadcastAvatarUrls } from './avatarClient.js';

function startTestHttpServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

test('requestAvatarUploadUrl posts state/ext and returns the parsed response', async () => {
  let receivedBody = null;
  const { server, port } = await startTestHttpServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      receivedBody = JSON.parse(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ uploadUrl: 'https://s3/x', version: 'v1' }));
    });
  });
  const result = await requestAvatarUploadUrl({ serverAddress: `localhost:${port}`, token: 'tok', state: 'silent', ext: 'png' });
  assert.deepEqual(result, { uploadUrl: 'https://s3/x', version: 'v1' });
  assert.deepEqual(receivedBody, { state: 'silent', ext: 'png' });
  server.close();
});

test('requestAvatarUploadUrl throws AvatarUploadError on a non-ok response', async () => {
  const { server, port } = await startTestHttpServer((req, res) => {
    res.writeHead(401);
    res.end();
  });
  await assert.rejects(
    () => requestAvatarUploadUrl({ serverAddress: `localhost:${port}`, token: 'bad', state: 'silent', ext: 'png' }),
    AvatarUploadError,
  );
  server.close();
});

test('confirmAvatarUpload posts state/version/ext and returns the parsed response', async () => {
  const { server, port } = await startTestHttpServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ avatarUrl: 'https://cdn/x' }));
  });
  const result = await confirmAvatarUpload({ serverAddress: `localhost:${port}`, token: 'tok', state: 'silent', version: 'v1', ext: 'png' });
  assert.deepEqual(result, { avatarUrl: 'https://cdn/x' });
  server.close();
});

test('confirmAvatarUpload throws AvatarUploadError on a non-ok response', async () => {
  const { server, port } = await startTestHttpServer((req, res) => {
    res.writeHead(400);
    res.end();
  });
  await assert.rejects(
    () => confirmAvatarUpload({ serverAddress: `localhost:${port}`, token: 'tok', state: 'silent', version: 'v1', ext: 'png' }),
    AvatarUploadError,
  );
  server.close();
});

test('confirmAvatarUpload surfaces the server\'s specific error message from a JSON error body', async () => {
  const { server, port } = await startTestHttpServer((req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Uploaded avatar exceeds the 5242880-byte limit' }));
  });
  await assert.rejects(
    () => confirmAvatarUpload({ serverAddress: `localhost:${port}`, token: 'tok', state: 'silent', version: 'v1', ext: 'png' }),
    (err) => {
      assert.ok(err instanceof AvatarUploadError);
      assert.ok(err.message.includes('Uploaded avatar exceeds the 5242880-byte limit'));
      return true;
    },
  );
  server.close();
});

test('clearBroadcastAvatar posts state and resolves on success', async () => {
  let receivedBody = null;
  const { server, port } = await startTestHttpServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      receivedBody = JSON.parse(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
  });
  await clearBroadcastAvatar({ serverAddress: `localhost:${port}`, token: 'tok', state: 'speaking' });
  assert.deepEqual(receivedBody, { state: 'speaking' });
  server.close();
});

test('getBroadcastAvatarUrls GETs with bearer auth and returns the parsed response', async () => {
  let receivedAuth = null;
  const { server, port } = await startTestHttpServer((req, res) => {
    receivedAuth = req.headers.authorization;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ silentURL: 'https://cdn/silent.png', speakingURL: null }));
  });
  const result = await getBroadcastAvatarUrls({ serverAddress: `localhost:${port}`, token: 'tok' });
  assert.deepEqual(result, { silentURL: 'https://cdn/silent.png', speakingURL: null });
  assert.equal(receivedAuth, 'Bearer tok');
  server.close();
});

test('getBroadcastAvatarUrls throws AvatarUploadError on a non-ok response', async () => {
  const { server, port } = await startTestHttpServer((req, res) => {
    res.writeHead(401);
    res.end();
  });
  await assert.rejects(
    () => getBroadcastAvatarUrls({ serverAddress: `localhost:${port}`, token: 'bad' }),
    AvatarUploadError,
  );
  server.close();
});

test('uploadFileToPresignedUrl PUTs the buffer with the given content type', async () => {
  let receivedContentType = null;
  let receivedBody = null;
  const { server, port } = await startTestHttpServer((req, res) => {
    receivedContentType = req.headers['content-type'];
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      receivedBody = Buffer.concat(chunks);
      res.writeHead(200);
      res.end();
    });
  });
  await uploadFileToPresignedUrl({ uploadUrl: `http://localhost:${port}/upload`, fileBuffer: Buffer.from('hello'), contentType: 'image/png' });
  assert.equal(receivedContentType, 'image/png');
  assert.equal(receivedBody.toString(), 'hello');
  server.close();
});

test('uploadFileToPresignedUrl throws AvatarUploadError on a non-ok response', async () => {
  const { server, port } = await startTestHttpServer((req, res) => {
    res.writeHead(500);
    res.end();
  });
  await assert.rejects(
    () => uploadFileToPresignedUrl({ uploadUrl: `http://localhost:${port}/upload`, fileBuffer: Buffer.from('x'), contentType: 'image/png' }),
    AvatarUploadError,
  );
  server.close();
});
