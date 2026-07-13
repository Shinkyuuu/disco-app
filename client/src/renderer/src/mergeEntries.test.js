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
import { mergeEntries } from './mergeEntries.js';

test('merges two disjoint lists and sorts by receivedAt', () => {
  const current = [{ speakerId: 'a', receivedAt: 200, text: 'second' }];
  const incoming = [{ speakerId: 'b', receivedAt: 100, text: 'first' }];
  assert.deepEqual(mergeEntries(current, incoming), [
    { speakerId: 'b', receivedAt: 100, text: 'first' },
    { speakerId: 'a', receivedAt: 200, text: 'second' },
  ]);
});

test('dedupes entries with the same speakerId+receivedAt, incoming winning', () => {
  const current = [{ speakerId: 'a', receivedAt: 100, text: 'stale' }];
  const incoming = [{ speakerId: 'a', receivedAt: 100, text: 'fresh' }];
  assert.deepEqual(mergeEntries(current, incoming), [{ speakerId: 'a', receivedAt: 100, text: 'fresh' }]);
});

test('a late-resolving empty snapshot does not erase already-appended live entries', () => {
  const current = [{ speakerId: 'a', receivedAt: 100, text: 'already live' }];
  assert.deepEqual(mergeEntries(current, []), current);
});

test('returns an empty list when both inputs are empty', () => {
  assert.deepEqual(mergeEntries([], []), []);
});
