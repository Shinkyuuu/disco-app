import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFontOption, resolveBorderOption, DEFAULT_FONT_ID, DEFAULT_BORDER_ID } from './chatAppearanceOptions.js';

test('resolveFontOption returns the matching option', () => {
  const option = resolveFontOption('determination');
  assert.equal(option.id, 'determination');
  assert.equal(option.label, 'Determination');
});

test('resolveFontOption falls back to the default for an unknown id', () => {
  assert.equal(resolveFontOption('does-not-exist').id, DEFAULT_FONT_ID);
});

test('resolveFontOption falls back to the default for null/undefined', () => {
  assert.equal(resolveFontOption(undefined).id, DEFAULT_FONT_ID);
  assert.equal(resolveFontOption(null).id, DEFAULT_FONT_ID);
});

test('resolveBorderOption returns the matching option', () => {
  const option = resolveBorderOption('soft');
  assert.equal(option.borderWidth, 1);
  assert.equal(option.borderRadius, 10);
});

test('resolveBorderOption falls back to the default for an unknown id', () => {
  assert.equal(resolveBorderOption('does-not-exist').id, DEFAULT_BORDER_ID);
});
