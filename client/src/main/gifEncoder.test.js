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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GifEncodingError, MIN_FRAMES, MAX_FRAMES, MAX_FRAME_BYTES, MIN_FPS, MAX_FPS, validateFrameInputs } from './gifEncoder.js';

function tmpFileOfSize(bytes) {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gif-test-')), 'frame.png');
  fs.writeFileSync(filePath, Buffer.alloc(bytes));
  return filePath;
}

test('exported bounds match the design spec', () => {
  assert.equal(MIN_FRAMES, 2);
  assert.equal(MAX_FRAMES, 30);
  assert.equal(MAX_FRAME_BYTES, 2 * 1024 * 1024);
  assert.equal(MIN_FPS, 1);
  assert.equal(MAX_FPS, 30);
});

test('validateFrameInputs accepts a valid frame count and fps', () => {
  const frames = [tmpFileOfSize(100), tmpFileOfSize(100)];
  assert.doesNotThrow(() => validateFrameInputs(frames, 6));
});

test('validateFrameInputs rejects fewer than MIN_FRAMES frames', () => {
  const frames = [tmpFileOfSize(100)];
  assert.throws(() => validateFrameInputs(frames, 6), (err) => {
    assert.ok(err instanceof GifEncodingError);
    assert.match(err.message, /Frame count/);
    return true;
  });
});

test('validateFrameInputs rejects more than MAX_FRAMES frames', () => {
  const frames = Array.from({ length: MAX_FRAMES + 1 }, () => tmpFileOfSize(100));
  assert.throws(() => validateFrameInputs(frames, 6), /Frame count/);
});

test('validateFrameInputs rejects a non-integer fps', () => {
  const frames = [tmpFileOfSize(100), tmpFileOfSize(100)];
  assert.throws(() => validateFrameInputs(frames, 6.5), (err) => {
    assert.ok(err instanceof GifEncodingError);
    assert.match(err.message, /fps/);
    return true;
  });
});

test('validateFrameInputs rejects an out-of-bounds fps', () => {
  const frames = [tmpFileOfSize(100), tmpFileOfSize(100)];
  assert.throws(() => validateFrameInputs(frames, 0), /fps/);
  assert.throws(() => validateFrameInputs(frames, 31), /fps/);
});

test('validateFrameInputs rejects a frame file over MAX_FRAME_BYTES', () => {
  const frames = [tmpFileOfSize(100), tmpFileOfSize(MAX_FRAME_BYTES + 1)];
  assert.throws(() => validateFrameInputs(frames, 6), (err) => {
    assert.ok(err instanceof GifEncodingError);
    assert.match(err.message, /exceeding/);
    return true;
  });
});
