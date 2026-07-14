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

test('betaUpdates is allowlisted', () => {
  assert.deepEqual(sanitizeSettingsPatch({ betaUpdates: true }), { betaUpdates: true });
});
