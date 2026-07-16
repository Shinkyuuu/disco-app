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
import { isNearBottom } from './isNearBottom.js';

test('is true when scrolled exactly to the bottom', () => {
  assert.equal(isNearBottom({ scrollHeight: 500, scrollTop: 300, clientHeight: 200 }, 30), true);
});

test('is true when within the threshold of the bottom', () => {
  assert.equal(isNearBottom({ scrollHeight: 500, scrollTop: 285, clientHeight: 200 }, 30), true);
});

test('is false when scrolled up past the threshold', () => {
  assert.equal(isNearBottom({ scrollHeight: 500, scrollTop: 100, clientHeight: 200 }, 30), false);
});

test('is true when there is nothing to scroll', () => {
  assert.equal(isNearBottom({ scrollHeight: 100, scrollTop: 0, clientHeight: 200 }, 30), true);
});

test('is true when the element ref is not yet attached', () => {
  assert.equal(isNearBottom(null, 30), true);
});
