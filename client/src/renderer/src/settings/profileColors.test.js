import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorsOf } from './profileColors.js';

test('picks just the color fields off a profile, ignoring avatar fields', () => {
  const profile = { usernameColor: '#ff0000', chatColor: '#00ff00', avatarSilent: 'x', avatarSpeaking: 'y' };
  assert.deepEqual(colorsOf(profile), { usernameColor: '#ff0000', chatColor: '#00ff00' });
});

test('passes through null colors unchanged', () => {
  assert.deepEqual(colorsOf({ usernameColor: null, chatColor: null }), { usernameColor: null, chatColor: null });
});
