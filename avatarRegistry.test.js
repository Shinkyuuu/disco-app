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

import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAvatarRegistry, ALLOWED_AVATAR_STATES, ALLOWED_AVATAR_EXTENSIONS, AvatarValidationError, isValidHexColor } from './avatarRegistry.js';

function fakeS3({ objects = new Map() } = {}) {
  return {
    objects,
    send: async (command) => {
      const name = command.constructor.name;
      const key = command.input.Key;
      if (name === 'HeadObjectCommand') {
        const obj = objects.get(key);
        if (!obj) {
          const err = new Error('not found');
          err.name = 'NotFound';
          throw err;
        }
        return { ContentLength: obj.body.length };
      }
      if (name === 'GetObjectCommand') {
        const obj = objects.get(key);
        if (!obj) {
          const err = new Error('not found');
          err.name = 'NoSuchKey';
          throw err;
        }
        return { Body: { transformToString: async () => obj.body } };
      }
      if (name === 'PutObjectCommand') {
        objects.set(key, { body: command.input.Body });
        return {};
      }
      throw new Error(`Unhandled command: ${name}`);
    },
  };
}

function fakeGetSignedUrl(client, command) {
  return Promise.resolve(`https://fake-s3.example.com/${command.input.Key}?signed=1`);
}

function makeRegistry(objects) {
  return createAvatarRegistry({
    s3Client: fakeS3({ objects }),
    bucket: 'test-bucket',
    cdnBaseUrl: 'https://cdn.example.com',
    getSignedUrl: fakeGetSignedUrl,
  });
}

test('ALLOWED_AVATAR_STATES and ALLOWED_AVATAR_EXTENSIONS are the expected fixed sets', () => {
  assert.deepEqual(ALLOWED_AVATAR_STATES, ['silent', 'speaking']);
  assert.deepEqual(ALLOWED_AVATAR_EXTENSIONS, ['png', 'jpg', 'jpeg', 'webp', 'gif']);
});

test('requestUploadUrl returns a signed URL scoped to a versioned key and a version token', async () => {
  const registry = makeRegistry();
  const { uploadUrl, version } = await registry.requestUploadUrl('user-1', 'silent', 'png');
  assert.match(uploadUrl, /^https:\/\/fake-s3\.example\.com\/avatars\/user-1\/[0-9a-f]+-silent\.png\?signed=1$/);
  assert.match(version, /^[0-9a-f]+$/);
});

test('requestUploadUrl rejects an invalid state', async () => {
  const registry = makeRegistry();
  await assert.rejects(() => registry.requestUploadUrl('user-1', 'bogus', 'png'), (err) => {
    assert.ok(err instanceof AvatarValidationError);
    assert.match(err.message, /Invalid avatar state/);
    return true;
  });
});

test('requestUploadUrl rejects an invalid extension', async () => {
  const registry = makeRegistry();
  await assert.rejects(() => registry.requestUploadUrl('user-1', 'silent', 'exe'), (err) => {
    assert.ok(err instanceof AvatarValidationError);
    assert.match(err.message, /Invalid avatar extension/);
    return true;
  });
});

test('confirmUpload validates the object landed, writes the manifest, and updates the in-memory cache', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  const { version } = await registry.requestUploadUrl('user-1', 'silent', 'png');
  // Simulate the client's direct-to-S3 PUT having landed.
  objects.set(`avatars/user-1/${version}-silent.png`, { body: Buffer.alloc(1024) });

  const avatarUrl = await registry.confirmUpload('user-1', 'silent', version, 'png');

  assert.equal(avatarUrl, `https://cdn.example.com/avatars/user-1/${version}-silent.png`);
  const cached = registry.getCachedAvatarUrls('user-1');
  assert.equal(cached.silentURL, avatarUrl);
  assert.equal(cached.speakingURL, null);

  const manifest = JSON.parse(objects.get('avatars/user-1/manifest.json').body);
  assert.deepEqual(manifest.silent, { version, ext: 'png' });
  assert.equal(manifest.speaking, undefined);
});

test('confirmUpload throws when the uploaded object was never actually written to S3', async () => {
  const registry = makeRegistry();
  await assert.rejects(
    () => registry.confirmUpload('user-1', 'silent', 'deadbeef', 'png'),
    (err) => {
      assert.ok(err instanceof AvatarValidationError);
      assert.match(err.message, /Uploaded object not found/);
      return true;
    },
  );
});

test('confirmUpload throws when the uploaded object exceeds the size limit', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  objects.set('avatars/user-1/deadbeef-silent.png', { body: Buffer.alloc(6 * 1024 * 1024) });
  await assert.rejects(
    () => registry.confirmUpload('user-1', 'silent', 'deadbeef', 'png'),
    (err) => {
      assert.ok(err instanceof AvatarValidationError);
      assert.match(err.message, /exceeds/);
      return true;
    },
  );
});

test('confirmUpload for speaking preserves an already-confirmed silent entry in the manifest', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  objects.set('avatars/user-1/aaa-silent.png', { body: Buffer.alloc(100) });
  await registry.confirmUpload('user-1', 'silent', 'aaa', 'png');

  objects.set('avatars/user-1/bbb-speaking.jpg', { body: Buffer.alloc(100) });
  await registry.confirmUpload('user-1', 'speaking', 'bbb', 'jpg');

  const cached = registry.getCachedAvatarUrls('user-1');
  assert.equal(cached.silentURL, 'https://cdn.example.com/avatars/user-1/aaa-silent.png');
  assert.equal(cached.speakingURL, 'https://cdn.example.com/avatars/user-1/bbb-speaking.jpg');
});

test('resolveAvatarUrls returns cached urls without touching S3 when already resolved', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  const { version } = await registry.requestUploadUrl('user-1', 'silent', 'png');
  objects.set(`avatars/user-1/${version}-silent.png`, { body: Buffer.alloc(100) });
  await registry.confirmUpload('user-1', 'silent', version, 'png');

  objects.delete('avatars/user-1/manifest.json'); // prove this isn't re-read
  const urls = await registry.resolveAvatarUrls('user-1');
  assert.equal(urls.silentURL, `https://cdn.example.com/avatars/user-1/${version}-silent.png`);
});

test('resolveAvatarUrls reads the S3 manifest for a user not yet in the in-memory cache', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  objects.set('avatars/user-2/manifest.json', {
    body: JSON.stringify({ silent: { version: 'zzz', ext: 'webp' }, speaking: null }),
  });

  const urls = await registry.resolveAvatarUrls('user-2');

  assert.equal(urls.silentURL, 'https://cdn.example.com/avatars/user-2/zzz-silent.webp');
  assert.equal(urls.speakingURL, null);
  assert.deepEqual(registry.getCachedAvatarUrls('user-2'), urls);
});

test('resolveAvatarUrls caches null for a user with no manifest, and never re-fetches', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);

  const first = await registry.resolveAvatarUrls('user-3');
  assert.equal(first, null);
  assert.equal(registry.getCachedAvatarUrls('user-3'), null);

  // If this were re-fetched, it would now find a manifest - proving the
  // negative cache is honored instead.
  objects.set('avatars/user-3/manifest.json', {
    body: JSON.stringify({ silent: { version: 'x', ext: 'png' } }),
  });
  const second = await registry.resolveAvatarUrls('user-3');
  assert.equal(second, null);
});

test('clearAvatar nulls one state while leaving the other intact', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  objects.set('avatars/user-1/aaa-silent.png', { body: Buffer.alloc(100) });
  objects.set('avatars/user-1/bbb-speaking.png', { body: Buffer.alloc(100) });
  await registry.confirmUpload('user-1', 'silent', 'aaa', 'png');
  await registry.confirmUpload('user-1', 'speaking', 'bbb', 'png');

  await registry.clearAvatar('user-1', 'silent');

  const cached = registry.getCachedAvatarUrls('user-1');
  assert.equal(cached.silentURL, null);
  assert.equal(cached.speakingURL, 'https://cdn.example.com/avatars/user-1/bbb-speaking.png');
  const manifest = JSON.parse(objects.get('avatars/user-1/manifest.json').body);
  assert.equal(manifest.silent, null);
});

test('clearAvatar caches null (not an object of nulls) once both states are cleared', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  objects.set('avatars/user-1/aaa-silent.png', { body: Buffer.alloc(100) });
  await registry.confirmUpload('user-1', 'silent', 'aaa', 'png');

  await registry.clearAvatar('user-1', 'silent');

  assert.equal(registry.getCachedAvatarUrls('user-1'), null);
});

test('clearAvatar on a user with no prior manifest is a safe no-op', async () => {
  const registry = makeRegistry();
  await registry.clearAvatar('user-never-uploaded', 'silent');
  assert.equal(registry.getCachedAvatarUrls('user-never-uploaded'), null);
});

test('clearAvatar rejects an invalid state', async () => {
  const registry = makeRegistry();
  await assert.rejects(() => registry.clearAvatar('user-1', 'bogus'), (err) => {
    assert.ok(err instanceof AvatarValidationError);
    assert.match(err.message, /Invalid avatar state/);
    return true;
  });
});

test('isValidHexColor accepts null and #rrggbb, rejects anything else', () => {
  assert.equal(isValidHexColor(null), true);
  assert.equal(isValidHexColor('#a1b2c3'), true);
  assert.equal(isValidHexColor('#A1B2C3'), true);
  assert.equal(isValidHexColor('red'), false);
  assert.equal(isValidHexColor('#fff'), false);
  assert.equal(isValidHexColor(undefined), false);
});

test('setProfileColors writes both colors into the manifest and the in-memory cache', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  const result = await registry.setProfileColors('user-1', { usernameColor: '#ff0000', chatColor: '#00ff00' });

  assert.deepEqual(result, { usernameColor: '#ff0000', chatColor: '#00ff00' });
  const cached = registry.getCachedAvatarUrls('user-1');
  assert.equal(cached.usernameColor, '#ff0000');
  assert.equal(cached.chatColor, '#00ff00');
  assert.equal(cached.silentURL, null);
  assert.equal(cached.speakingURL, null);

  const manifest = JSON.parse(objects.get('avatars/user-1/manifest.json').body);
  assert.equal(manifest.usernameColor, '#ff0000');
  assert.equal(manifest.chatColor, '#00ff00');
});

test('setProfileColors preserves an already-confirmed avatar image in the manifest', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  objects.set('avatars/user-1/aaa-silent.png', { body: Buffer.alloc(100) });
  await registry.confirmUpload('user-1', 'silent', 'aaa', 'png');

  await registry.setProfileColors('user-1', { usernameColor: '#123456', chatColor: null });

  const cached = registry.getCachedAvatarUrls('user-1');
  assert.equal(cached.silentURL, 'https://cdn.example.com/avatars/user-1/aaa-silent.png');
  assert.equal(cached.usernameColor, '#123456');
  assert.equal(cached.chatColor, null);
});

test('confirmUpload preserves already-set colors in the manifest', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  await registry.setProfileColors('user-1', { usernameColor: '#123456', chatColor: '#654321' });

  objects.set('avatars/user-1/aaa-silent.png', { body: Buffer.alloc(100) });
  await registry.confirmUpload('user-1', 'silent', 'aaa', 'png');

  const cached = registry.getCachedAvatarUrls('user-1');
  assert.equal(cached.usernameColor, '#123456');
  assert.equal(cached.chatColor, '#654321');
  assert.equal(cached.silentURL, 'https://cdn.example.com/avatars/user-1/aaa-silent.png');
});

test('setProfileColors rejects an invalid color', async () => {
  const registry = makeRegistry();
  await assert.rejects(() => registry.setProfileColors('user-1', { usernameColor: 'not-a-color', chatColor: null }), (err) => {
    assert.ok(err instanceof AvatarValidationError);
    return true;
  });
});

test('resolveAvatarUrls surfaces colors for a user read fresh from S3 with no avatar images', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  objects.set('avatars/user-2/manifest.json', {
    body: JSON.stringify({ usernameColor: '#aabbcc', chatColor: '#112233' }),
  });

  const urls = await registry.resolveAvatarUrls('user-2');

  assert.equal(urls.usernameColor, '#aabbcc');
  assert.equal(urls.chatColor, '#112233');
  assert.equal(urls.silentURL, null);
});

test('clearAvatar does not wipe out colors when only an avatar image is cleared', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  objects.set('avatars/user-1/aaa-silent.png', { body: Buffer.alloc(100) });
  await registry.confirmUpload('user-1', 'silent', 'aaa', 'png');
  await registry.setProfileColors('user-1', { usernameColor: '#ff00ff', chatColor: null });

  await registry.clearAvatar('user-1', 'silent');

  const cached = registry.getCachedAvatarUrls('user-1');
  assert.equal(cached.silentURL, null);
  assert.equal(cached.usernameColor, '#ff00ff');
});

test('clearAvatar still caches null once avatar images AND colors are both empty', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  objects.set('avatars/user-1/aaa-silent.png', { body: Buffer.alloc(100) });
  await registry.confirmUpload('user-1', 'silent', 'aaa', 'png');

  await registry.clearAvatar('user-1', 'silent');

  assert.equal(registry.getCachedAvatarUrls('user-1'), null);
});
