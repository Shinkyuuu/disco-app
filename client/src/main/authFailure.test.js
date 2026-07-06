import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRetryableAuthFailure } from './authFailure.js';

test('"not in voice channel" is retryable - the token is still valid', () => {
  assert.equal(isRetryableAuthFailure('not in voice channel'), true);
});

test('"invalid or expired token" is not retryable - the token itself is bad', () => {
  assert.equal(isRetryableAuthFailure('invalid or expired token'), false);
});
