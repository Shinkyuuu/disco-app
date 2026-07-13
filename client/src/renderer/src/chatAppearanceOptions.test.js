/*
 * Copyright 2026 Cody Park
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
