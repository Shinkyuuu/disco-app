import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMaxActiveSessions } from './bot.js';

test('resolveMaxActiveSessions defaults to 5 when unset', () => {
  assert.equal(resolveMaxActiveSessions(undefined), 5);
});

test('resolveMaxActiveSessions defaults to 5 for an empty string', () => {
  assert.equal(resolveMaxActiveSessions(''), 5);
});

test('resolveMaxActiveSessions parses a valid numeric string', () => {
  assert.equal(resolveMaxActiveSessions('10'), 10);
});

test('resolveMaxActiveSessions falls back to 5 for a non-numeric value instead of disabling the cap', () => {
  assert.equal(resolveMaxActiveSessions('not-a-number'), 5);
});
