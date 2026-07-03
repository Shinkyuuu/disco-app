import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthToken, parseAuthError } from './protocolUrl.js';

test('extracts the token from a valid discord-echo:// auth URL', () => {
  assert.equal(parseAuthToken('discord-echo://auth?token=abc123'), 'abc123');
});

test('returns null for a non-discord-echo URL', () => {
  assert.equal(parseAuthToken('https://example.com?token=abc123'), null);
});

test('returns null when there is no token param', () => {
  assert.equal(parseAuthToken('discord-echo://auth'), null);
});

test('returns null for a malformed URL', () => {
  assert.equal(parseAuthToken('not a url'), null);
});

test('parseAuthError extracts the error from a denied-login redirect', () => {
  assert.equal(parseAuthError('discord-echo://auth?error=access_denied'), 'access_denied');
});

test('parseAuthError returns null when there is no error param', () => {
  assert.equal(parseAuthError('discord-echo://auth?token=abc123'), null);
});
