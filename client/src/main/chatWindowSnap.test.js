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
import { nearestEdge, snappedPosition } from './chatWindowSnap.js';

const boundsRect = { x: 0, y: 0, width: 1920, height: 1080 };
// A taskbar docked at the bottom, 40px tall - workArea's bottom line sits
// 40px above the true physical bottom.
const workAreaRect = { x: 0, y: 0, width: 1920, height: 1040 };

test('nearestEdge picks the edge with the smallest gap (no taskbar reservation - workArea equals bounds)', () => {
  assert.deepEqual(nearestEdge({ x: 10, y: 400, width: 480, height: 300 }, boundsRect, boundsRect), { edge: 'left', target: 'bounds' });
  assert.deepEqual(nearestEdge({ x: 1420, y: 400, width: 480, height: 300 }, boundsRect, boundsRect), { edge: 'right', target: 'bounds' });
  assert.deepEqual(nearestEdge({ x: 700, y: 10, width: 480, height: 300 }, boundsRect, boundsRect), { edge: 'top', target: 'bounds' });
  assert.deepEqual(nearestEdge({ x: 700, y: 760, width: 480, height: 300 }, boundsRect, boundsRect), { edge: 'bottom', target: 'bounds' });
});

test('nearestEdge never picks a corner - exactly one edge wins even near a corner', () => {
  // 10px from the left, 20px from the top - left is nearer, so it wins outright.
  assert.deepEqual(nearestEdge({ x: 10, y: 20, width: 480, height: 300 }, boundsRect, boundsRect), { edge: 'left', target: 'bounds' });
});

test('nearestEdge prefers the workArea (taskbar) line when a window is released nearer to it than the true screen edge', () => {
  // Bottom at 1035: 5px above the taskbar line (workArea bottom = 1040), 45px above the true bottom (1080).
  const bounds = { x: 700, y: 735, width: 480, height: 300 };
  assert.deepEqual(nearestEdge(bounds, boundsRect, workAreaRect), { edge: 'bottom', target: 'workArea' });
});

test('nearestEdge prefers the true screen edge when nearer to it, even if the window already overlaps the taskbar line', () => {
  // Bottom at 1075: only 5px above the true bottom (1080), but already 35px PAST the taskbar line (1040).
  // Uses absolute distance so this large overlap doesn't read as "infinitely close" to workArea.
  const bounds = { x: 700, y: 775, width: 480, height: 300 };
  assert.deepEqual(nearestEdge(bounds, boundsRect, workAreaRect), { edge: 'bottom', target: 'bounds' });
});

test('nearestEdge on an edge the taskbar does not touch is unaffected by it, defaulting to the bounds target on the resulting tie', () => {
  const bounds = { x: 10, y: 400, width: 480, height: 300 };
  assert.deepEqual(nearestEdge(bounds, boundsRect, workAreaRect), { edge: 'left', target: 'bounds' });
});

test('snappedPosition pins the window flush against the given edge', () => {
  const bounds = { x: 700, y: 400, width: 480, height: 300 };
  assert.deepEqual(snappedPosition(bounds, boundsRect, 'left'), { x: 0, y: 400 });
  assert.deepEqual(snappedPosition(bounds, boundsRect, 'right'), { x: 1920 - 480, y: 400 });
  assert.deepEqual(snappedPosition(bounds, boundsRect, 'top'), { x: 700, y: 0 });
  assert.deepEqual(snappedPosition(bounds, boundsRect, 'bottom'), { x: 700, y: 1080 - 300 });
});

test('snappedPosition clamps the cross-axis so the window stays on-rect', () => {
  const bounds = { x: -50, y: 400, width: 480, height: 300 };
  const result = snappedPosition(bounds, boundsRect, 'top');
  assert.equal(result.x, 0); // clamped from -50
  assert.equal(result.y, 0);
});

test('snappedPosition works against a non-origin display (second monitor)', () => {
  const secondDisplay = { x: 1920, y: 0, width: 1280, height: 720 };
  const bounds = { x: 2000, y: 300, width: 480, height: 300 };
  assert.deepEqual(snappedPosition(bounds, secondDisplay, 'right'), { x: 1920 + 1280 - 480, y: 300 });
});

test('snappedPosition against a workArea rect puts the window flush above the taskbar, not the true bottom', () => {
  const bounds = { x: 700, y: 700, width: 480, height: 300 };
  assert.deepEqual(snappedPosition(bounds, workAreaRect, 'bottom'), { x: 700, y: 1040 - 300 });
});
