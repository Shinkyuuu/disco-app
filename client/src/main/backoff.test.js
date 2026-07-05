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
