import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthToken, parseAuthError, parseAuthUserId } from './protocolUrl.js';

test('extracts the token from a valid disco:// auth URL', () => {
  assert.equal(parseAuthToken('disco://auth?token=abc123'), 'abc123');
});

test('returns null for a non-disco URL', () => {
  assert.equal(parseAuthToken('https://example.com?token=abc123'), null);
});

test('returns null when there is no token param', () => {
  assert.equal(parseAuthToken('disco://auth'), null);
});

test('returns null for a malformed URL', () => {
  assert.equal(parseAuthToken('not a url'), null);
});

test('parseAuthError extracts the error from a denied-login redirect', () => {
  assert.equal(parseAuthError('disco://auth?error=access_denied'), 'access_denied');
});

test('parseAuthError returns null when there is no error param', () => {
  assert.equal(parseAuthError('disco://auth?token=abc123'), null);
});

test('parseAuthUserId extracts the userId from a success redirect', () => {
  assert.equal(parseAuthUserId('disco://auth?token=abc&userId=123456789'), '123456789');
});

test('parseAuthUserId returns null when there is no userId param', () => {
  assert.equal(parseAuthUserId('disco://auth?token=abc'), null);
});

test('parseAuthUserId returns null for a non-disco URL', () => {
  assert.equal(parseAuthUserId('https://example.com?userId=123'), null);
});
