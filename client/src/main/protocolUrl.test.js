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
import { parseAuthCode, parseAuthError } from './protocolUrl.js';

test('extracts the exchange code from a valid disco:// auth URL', () => {
  assert.equal(parseAuthCode('disco://auth?code=abc123'), 'abc123');
});

test('returns null for a non-disco URL', () => {
  assert.equal(parseAuthCode('https://example.com?code=abc123'), null);
});

test('returns null when there is no code param', () => {
  assert.equal(parseAuthCode('disco://auth'), null);
});

test('returns null for a malformed URL', () => {
  assert.equal(parseAuthCode('not a url'), null);
});

test('parseAuthError extracts the error from a denied-login redirect', () => {
  assert.equal(parseAuthError('disco://auth?error=access_denied'), 'access_denied');
});

test('parseAuthError returns null when there is no error param', () => {
  assert.equal(parseAuthError('disco://auth?code=abc123'), null);
});
