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
import { schemeFor } from './serverScheme.js';

test('returns the insecure scheme for a bare host:port (local dev)', () => {
  assert.equal(schemeFor('localhost:3000', { secure: 'https', insecure: 'http' }), 'http');
  assert.equal(schemeFor('127.0.0.1:5000', { secure: 'https', insecure: 'http' }), 'http');
});

test('returns the secure scheme for a hosted hostname (no port)', () => {
  assert.equal(schemeFor('echo.example.com', { secure: 'https', insecure: 'http' }), 'https');
});

test('works for the ws/wss pair too', () => {
  assert.equal(schemeFor('localhost:3000', { secure: 'wss', insecure: 'ws' }), 'ws');
  assert.equal(schemeFor('echo.example.com', { secure: 'wss', insecure: 'ws' }), 'wss');
});
