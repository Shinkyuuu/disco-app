import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionToken, verifySessionToken } from './auth.js';

test('createSessionToken then verifySessionToken returns the same userId', () => {
  const token = createSessionToken('user-123');
  assert.equal(verifySessionToken(token), 'user-123');
});

test('verifySessionToken returns null for an unknown token', () => {
  assert.equal(verifySessionToken('not-a-real-token'), null);
});

test('verifySessionToken returns null and purges an expired token', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const token = createSessionToken('user-456');
  t.mock.timers.tick(4 * 60 * 60 * 1000 + 1); // just past the 4h TTL
  assert.equal(verifySessionToken(token), null);
  assert.equal(verifySessionToken(token), null); // purged, not just "expired but still there"
});
