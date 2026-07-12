import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSettingsPatch } from './settingsKeys.js';

test('keeps known settings keys', () => {
  assert.deepEqual(sanitizeSettingsPatch({ avatarSize: 'large', chatOpacity: 0.5 }), {
    avatarSize: 'large',
    chatOpacity: 0.5,
  });
});

test('drops unknown keys, including sensitive store fields', () => {
  assert.deepEqual(
    sanitizeSettingsPatch({
      avatarSize: 'large',
      sessionToken: 'stolen',
      loggedInUserId: '1',
      defaultProfiles: [],
      chatWindowWidth: 9999,
    }),
    { avatarSize: 'large' },
  );
});

test('returns an empty object when nothing is allowlisted', () => {
  assert.deepEqual(sanitizeSettingsPatch({ notAKey: true }), {});
});

test('serverAddress is not allowlisted (it is set via the SERVER_ADDRESS env var, not the renderer)', () => {
  assert.deepEqual(sanitizeSettingsPatch({ serverAddress: 'my.server.com' }), {});
});
