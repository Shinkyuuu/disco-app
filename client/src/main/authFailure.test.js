import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRetryableAuthFailure } from './authFailure.js';

test('close code 4001 (not in voice channel) is retryable - the token is still valid', () => {
  assert.equal(isRetryableAuthFailure(4001), true);
});

test('close code 4003 (invalid or expired token) is not retryable - the token itself is bad', () => {
  assert.equal(isRetryableAuthFailure(4003), false);
});

test('close code 4002 (invalid auth payload) is not retryable', () => {
  assert.equal(isRetryableAuthFailure(4002), false);
});

test('close code 4008 (auth timeout) is not retryable', () => {
  assert.equal(isRetryableAuthFailure(4008), false);
});
