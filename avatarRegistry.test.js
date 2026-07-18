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
import { createAvatarRegistry, ALLOWED_AVATAR_STATES, ALLOWED_AVATAR_EXTENSIONS, ALLOWED_STATIC_AVATAR_EXTENSIONS, SPEAKING_AVATAR_TYPES, extensionsForState, AvatarValidationError, isValidHexColor } from './avatarRegistry.js';

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

test('ALLOWED_AVATAR_STATES, ALLOWED_AVATAR_EXTENSIONS, and ALLOWED_STATIC_AVATAR_EXTENSIONS are the expected fixed sets', () => {
  assert.deepEqual(ALLOWED_AVATAR_STATES, ['silent', 'speaking-image', 'speaking-gif', 'speaking-frames']);
  assert.deepEqual(SPEAKING_AVATAR_TYPES, ['image', 'gif', 'frames']);
  assert.deepEqual(ALLOWED_AVATAR_EXTENSIONS, ['png', 'jpg', 'jpeg', 'webp', 'gif']);
  assert.deepEqual(ALLOWED_STATIC_AVATAR_EXTENSIONS, ['png', 'jpg', 'jpeg', 'webp']);
});

test('extensionsForState excludes .gif for silent and speaking-image, allows it for speaking-gif and speaking-frames', () => {
  assert.deepEqual(extensionsForState('silent'), ALLOWED_STATIC_AVATAR_EXTENSIONS);
  assert.deepEqual(extensionsForState('speaking-image'), ALLOWED_STATIC_AVATAR_EXTENSIONS);
  assert.deepEqual(extensionsForState('speaking-gif'), ALLOWED_AVATAR_EXTENSIONS);
  assert.deepEqual(extensionsForState('speaking-frames'), ALLOWED_AVATAR_EXTENSIONS);
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

test('requestUploadUrl rejects a .gif extension for silent (must stay static)', async () => {
  const registry = makeRegistry();
  await assert.rejects(() => registry.requestUploadUrl('user-1', 'silent', 'gif'), (err) => {
    assert.ok(err instanceof AvatarValidationError);
    assert.match(err.message, /Invalid avatar extension/);
    return true;
  });
});

test('requestUploadUrl accepts a .gif extension for speaking-gif', async () => {
  const registry = makeRegistry();
  const { uploadUrl } = await registry.requestUploadUrl('user-1', 'speaking-gif', 'gif');
  assert.match(uploadUrl, /speaking-gif\.gif/);
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

test('confirmUpload for a speaking variant preserves an already-confirmed silent entry in the manifest', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  objects.set('avatars/user-1/aaa-silent.png', { body: Buffer.alloc(100) });
  await registry.confirmUpload('user-1', 'silent', 'aaa', 'png');

  objects.set('avatars/user-1/bbb-speaking-image.jpg', { body: Buffer.alloc(100) });
  await registry.confirmUpload('user-1', 'speaking-image', 'bbb', 'jpg');

  const cached = registry.getCachedAvatarUrls('user-1');
  assert.equal(cached.silentURL, 'https://cdn.example.com/avatars/user-1/aaa-silent.png');
  assert.equal(cached.speakingURL, 'https://cdn.example.com/avatars/user-1/bbb-speaking-image.jpg');
});

test('confirmUpload for a speaking variant sets it as the active type', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  objects.set('avatars/user-1/bbb-speaking-gif.gif', { body: Buffer.alloc(100) });
  await registry.confirmUpload('user-1', 'speaking-gif', 'bbb', 'gif');

  const manifest = JSON.parse(objects.get('avatars/user-1/manifest.json').body);
  assert.equal(manifest.speaking.activeType, 'gif');
  assert.deepEqual(manifest.speaking.gif, { version: 'bbb', ext: 'gif' });
});

test('confirmUpload for a new speaking variant does not clobber a previously-uploaded variant, but does become the active one', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  objects.set('avatars/user-1/aaa-speaking-image.png', { body: Buffer.alloc(100) });
  await registry.confirmUpload('user-1', 'speaking-image', 'aaa', 'png');

  objects.set('avatars/user-1/bbb-speaking-gif.gif', { body: Buffer.alloc(100) });
  await registry.confirmUpload('user-1', 'speaking-gif', 'bbb', 'gif');

  const manifest = JSON.parse(objects.get('avatars/user-1/manifest.json').body);
  assert.deepEqual(manifest.speaking.image, { version: 'aaa', ext: 'png' });
  assert.deepEqual(manifest.speaking.gif, { version: 'bbb', ext: 'gif' });
  assert.equal(manifest.speaking.activeType, 'gif');

  const cached = registry.getCachedAvatarUrls('user-1');
  assert.equal(cached.speakingURL, 'https://cdn.example.com/avatars/user-1/bbb-speaking-gif.gif');
});

test('confirmUpload for speaking-frames stores fps and frameCount alongside version/ext', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  objects.set('avatars/user-1/ccc-speaking-frames.gif', { body: Buffer.alloc(100) });
  await registry.confirmUpload('user-1', 'speaking-frames', 'ccc', 'gif', { fps: 6, frameCount: 12 });

  const manifest = JSON.parse(objects.get('avatars/user-1/manifest.json').body);
  assert.deepEqual(manifest.speaking.frames, { version: 'ccc', ext: 'gif', fps: 6, frameCount: 12 });
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

test('clearAvatar nulls silent while leaving speaking intact', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  objects.set('avatars/user-1/aaa-silent.png', { body: Buffer.alloc(100) });
  objects.set('avatars/user-1/bbb-speaking-image.png', { body: Buffer.alloc(100) });
  await registry.confirmUpload('user-1', 'silent', 'aaa', 'png');
  await registry.confirmUpload('user-1', 'speaking-image', 'bbb', 'png');

  await registry.clearAvatar('user-1', 'silent');

  const cached = registry.getCachedAvatarUrls('user-1');
  assert.equal(cached.silentURL, null);
  assert.equal(cached.speakingURL, 'https://cdn.example.com/avatars/user-1/bbb-speaking-image.png');
  const manifest = JSON.parse(objects.get('avatars/user-1/manifest.json').body);
  assert.equal(manifest.silent, null);
});

test('clearAvatar nulls only the cleared speaking variant, leaving other variants intact', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  objects.set('avatars/user-1/aaa-speaking-image.png', { body: Buffer.alloc(100) });
  objects.set('avatars/user-1/bbb-speaking-gif.gif', { body: Buffer.alloc(100) });
  await registry.confirmUpload('user-1', 'speaking-image', 'aaa', 'png');
  await registry.confirmUpload('user-1', 'speaking-gif', 'bbb', 'gif');

  await registry.clearAvatar('user-1', 'speaking-gif');

  const manifest = JSON.parse(objects.get('avatars/user-1/manifest.json').body);
  assert.deepEqual(manifest.speaking.image, { version: 'aaa', ext: 'png' });
  assert.equal(manifest.speaking.gif, null);
});

test('clearAvatar nulls activeType when the active variant is cleared, without falling back to another populated variant', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  objects.set('avatars/user-1/aaa-speaking-image.png', { body: Buffer.alloc(100) });
  objects.set('avatars/user-1/bbb-speaking-gif.gif', { body: Buffer.alloc(100) });
  await registry.confirmUpload('user-1', 'speaking-image', 'aaa', 'png');
  await registry.confirmUpload('user-1', 'speaking-gif', 'bbb', 'gif'); // becomes active

  await registry.clearAvatar('user-1', 'speaking-gif');

  const manifest = JSON.parse(objects.get('avatars/user-1/manifest.json').body);
  assert.equal(manifest.speaking.activeType, null);
  // No active speaking variant and no silent/colors means hasAnyProfileData
  // is false, so the whole cache entry collapses to null (same convention as
  // "clearAvatar caches null once both states are cleared" below) - it does
  // not fall back to a non-null object with speakingURL: null.
  const cached = registry.getCachedAvatarUrls('user-1');
  assert.equal(cached, null);
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

test('setActiveSpeakingType switches to an already-populated variant without re-uploading', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  objects.set('avatars/user-1/aaa-speaking-image.png', { body: Buffer.alloc(100) });
  objects.set('avatars/user-1/bbb-speaking-gif.gif', { body: Buffer.alloc(100) });
  await registry.confirmUpload('user-1', 'speaking-image', 'aaa', 'png');
  await registry.confirmUpload('user-1', 'speaking-gif', 'bbb', 'gif'); // becomes active

  const speakingURL = await registry.setActiveSpeakingType('user-1', 'image');

  assert.equal(speakingURL, 'https://cdn.example.com/avatars/user-1/aaa-speaking-image.png');
  const cached = registry.getCachedAvatarUrls('user-1');
  assert.equal(cached.speakingURL, 'https://cdn.example.com/avatars/user-1/aaa-speaking-image.png');
  const manifest = JSON.parse(objects.get('avatars/user-1/manifest.json').body);
  assert.equal(manifest.speaking.activeType, 'image');
});

test('setActiveSpeakingType rejects a variant with no uploaded content', async () => {
  const objects = new Map();
  const registry = makeRegistry(objects);
  objects.set('avatars/user-1/aaa-speaking-image.png', { body: Buffer.alloc(100) });
  await registry.confirmUpload('user-1', 'speaking-image', 'aaa', 'png');

  await assert.rejects(() => registry.setActiveSpeakingType('user-1', 'frames'), (err) => {
    assert.ok(err instanceof AvatarValidationError);
    assert.match(err.message, /No frames speaking avatar/);
    return true;
  });
});

test('setActiveSpeakingType rejects an invalid type', async () => {
  const registry = makeRegistry();
  await assert.rejects(() => registry.setActiveSpeakingType('user-1', 'bogus'), (err) => {
    assert.ok(err instanceof AvatarValidationError);
    assert.match(err.message, /Invalid speaking avatar type/);
    return true;
  });
});

test('setActiveSpeakingType on a user with no manifest at all rejects (nothing populated)', async () => {
  const registry = makeRegistry();
  await assert.rejects(() => registry.setActiveSpeakingType('user-never-uploaded', 'image'), AvatarValidationError);
});
