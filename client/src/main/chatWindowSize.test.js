import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatWindowHeightFor, HEADER_HEIGHT_BY_AVATAR_SIZE } from './chatWindowSize.js';

test('expanded height is header height plus the given panel height', () => {
  assert.equal(chatWindowHeightFor('small', { panelHeight: 324 }), HEADER_HEIGHT_BY_AVATAR_SIZE.small + 324);
  assert.equal(chatWindowHeightFor('large', { panelHeight: 400 }), HEADER_HEIGHT_BY_AVATAR_SIZE.large + 400);
});

test('collapsed height is exactly the header height, ignoring panelHeight', () => {
  assert.equal(
    chatWindowHeightFor('medium', { collapsed: true, panelHeight: 900 }),
    HEADER_HEIGHT_BY_AVATAR_SIZE.medium,
  );
});

test('unknown avatar size falls back to small', () => {
  assert.equal(chatWindowHeightFor('huge', { panelHeight: 324 }), HEADER_HEIGHT_BY_AVATAR_SIZE.small + 324);
});

test('defaults to expanded with the standard panel height when no options are given', () => {
  assert.equal(chatWindowHeightFor('small'), HEADER_HEIGHT_BY_AVATAR_SIZE.small + 324);
});
