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
import { toastPositionFor, TOAST_WIDTH, TOAST_HEIGHT } from './toastPosition.js';

test('toastPositionFor centers above the chat window when there is room above', () => {
  const chatWindowBounds = { x: 700, y: 500, width: 480, height: 400 };
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  const result = toastPositionFor(chatWindowBounds, workArea);
  assert.equal(result.y, 500 - TOAST_HEIGHT - 8);
  assert.equal(result.x, 700 + Math.round((480 - TOAST_WIDTH) / 2));
});

test('toastPositionFor opens below the chat window when there is no room above', () => {
  const chatWindowBounds = { x: 700, y: 10, width: 480, height: 400 };
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  const result = toastPositionFor(chatWindowBounds, workArea);
  assert.equal(result.y, 10 + 400 + 8);
});

test('toastPositionFor clamps x within the work area on both sides', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };

  const nearRightEdge = toastPositionFor({ x: 1850, y: 500, width: 480, height: 400 }, workArea);
  assert.equal(nearRightEdge.x, 1920 - TOAST_WIDTH);

  const nearLeftEdge = toastPositionFor({ x: -300, y: 500, width: 480, height: 400 }, workArea);
  assert.equal(nearLeftEdge.x, 0);
});

test('toastPositionFor falls back to the work area top-right corner when there is no chat window', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  const result = toastPositionFor(null, workArea);
  assert.equal(result.x, 1920 - TOAST_WIDTH - 16);
  assert.equal(result.y, 16);
});
