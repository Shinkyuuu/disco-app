import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chatWindowHeightFor,
  chatWindowWidthFor,
  HEADER_HEIGHT_BY_AVATAR_SIZE,
  HEADER_HEIGHT_BY_AVATAR_SIZE_DISCORD,
  AVATAR_WIDTH_BY_SIZE,
  AVATAR_WIDTH_BY_SIZE_DISCORD,
  AVATAR_GAP_BY_SIZE,
  MIN_CHAT_WINDOW_WIDTH,
  headerHeightFor,
} from './chatWindowSize.js';

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

test('discord avatarMode uses the smaller discord header heights', () => {
  assert.equal(
    chatWindowHeightFor('small', { avatarMode: 'discord', panelHeight: 324 }),
    HEADER_HEIGHT_BY_AVATAR_SIZE_DISCORD.small + 324,
  );
  assert.equal(
    chatWindowHeightFor('large', { avatarMode: 'discord', collapsed: true }),
    HEADER_HEIGHT_BY_AVATAR_SIZE_DISCORD.large,
  );
});

test('custom avatarMode (or unspecified) keeps the original header heights', () => {
  assert.equal(headerHeightFor('medium', 'custom'), HEADER_HEIGHT_BY_AVATAR_SIZE.medium);
  assert.equal(headerHeightFor('medium', undefined), HEADER_HEIGHT_BY_AVATAR_SIZE.medium);
});

test('width sums avatar widths plus gaps for a discord-mode roster, using the discord avatar table', () => {
  const n = 5;
  const expected = n * AVATAR_WIDTH_BY_SIZE_DISCORD.medium + (n - 1) * AVATAR_GAP_BY_SIZE.medium + 32 + 12;
  assert.equal(chatWindowWidthFor(n, 'medium', 'discord'), expected);
});

test('width uses the custom avatar table for custom avatarMode', () => {
  const n = 4;
  const expected = n * AVATAR_WIDTH_BY_SIZE.large + (n - 1) * AVATAR_GAP_BY_SIZE.large + 32 + 12;
  assert.equal(chatWindowWidthFor(n, 'large', 'custom'), expected);
});

test('width is clamped to the minimum chat window width for small rosters', () => {
  assert.equal(chatWindowWidthFor(0, 'small', 'discord'), MIN_CHAT_WINDOW_WIDTH);
  assert.equal(chatWindowWidthFor(1, 'small', 'discord'), MIN_CHAT_WINDOW_WIDTH);
});

test('width grows as roster size grows', () => {
  const small = chatWindowWidthFor(3, 'small', 'discord');
  const large = chatWindowWidthFor(8, 'small', 'discord');
  assert.ok(large > small);
});

test('unknown avatar size falls back to small for width', () => {
  assert.equal(chatWindowWidthFor(5, 'huge', 'discord'), chatWindowWidthFor(5, 'small', 'discord'));
});
