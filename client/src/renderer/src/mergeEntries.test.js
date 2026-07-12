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
