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
import { isRetryableAuthFailure } from './authFailure.js';

test('close code 4001 (not in voice channel) is retryable - the token is still valid', () => {
  assert.equal(isRetryableAuthFailure(4001), true);
});

test('close code 4003 (invalid or expired token) is not retryable - the token itself is bad', () => {
  assert.equal(isRetryableAuthFailure(4003), false);
});

test('close code 4002 (invalid auth payload) is not retryable', () => {
  assert.equal(isRetryableAuthFailure(4002), false);
});

test('close code 4008 (auth timeout) is not retryable', () => {
  assert.equal(isRetryableAuthFailure(4008), false);
});
