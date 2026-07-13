import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMaxActiveSessions, extractFluxTranscript } from './bot.js';

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

test('extractFluxTranscript returns the transcript on an EndOfTurn TurnInfo message', () => {
  const msg = { type: 'TurnInfo', event: 'EndOfTurn', transcript: 'hello there' };
  assert.equal(extractFluxTranscript(msg), 'hello there');
});

test('extractFluxTranscript ignores intermediate Update events', () => {
  const msg = { type: 'TurnInfo', event: 'Update', transcript: 'hello' };
  assert.equal(extractFluxTranscript(msg), null);
});

test('extractFluxTranscript ignores non-TurnInfo messages (e.g. Connected, Error)', () => {
  assert.equal(extractFluxTranscript({ type: 'Connected' }), null);
  assert.equal(extractFluxTranscript({ type: 'Error', code: 'INTERNAL_SERVER_ERROR' }), null);
});

test('extractFluxTranscript returns null for an EndOfTurn with an empty transcript', () => {
  const msg = { type: 'TurnInfo', event: 'EndOfTurn', transcript: '' };
  assert.equal(extractFluxTranscript(msg), null);
});
