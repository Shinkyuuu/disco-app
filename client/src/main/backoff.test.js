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
import { nextDelay } from './backoff.js';

test('grows exponentially with a base of 500ms', () => {
  assert.equal(nextDelay(0), 500);
  assert.equal(nextDelay(1), 1000);
  assert.equal(nextDelay(2), 2000);
  assert.equal(nextDelay(3), 4000);
});

test('caps at 30 seconds', () => {
  assert.equal(nextDelay(10), 30000);
  assert.equal(nextDelay(100), 30000);
});
