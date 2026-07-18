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
import { GifEncodingError, MIN_FRAMES, MAX_FRAMES, MAX_FRAME_BYTES, MIN_FPS, MAX_FPS, validateFrameInputs, encodeFramesToGif } from './gifEncoder.js';
import { Jimp } from 'jimp';

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

// Real GIF89a bytes: writes a synthetic solid-color PNG to a temp file for
// use as a source frame.
async function tmpSolidColorPng(width, height, rgba) {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gif-test-')), 'frame.png');
  const image = new Jimp({ width, height, color: rgba });
  await image.write(filePath);
  return filePath;
}

// Scans raw GIF bytes for Graphic Control Extension blocks (`21 F9 04 ...`)
// - one is written per frame by gifenc - and returns each block's stored
// delay in centiseconds (GIF's native unit), so tests can check both frame
// count and per-frame timing without a GIF decoder dependency. Block layout:
// 21 F9 04 <flags:1> <delay:2 LE> <transparent index:1> 00.
function readGraphicControlExtensions(gifBytes) {
  const blocks = [];
  for (let i = 0; i < gifBytes.length - 7; i++) {
    if (gifBytes[i] === 0x21 && gifBytes[i + 1] === 0xf9 && gifBytes[i + 2] === 0x04) {
      const delayCentiseconds = gifBytes[i + 4] | (gifBytes[i + 5] << 8);
      blocks.push({ delayCentiseconds });
    }
  }
  return blocks;
}

test('encodeFramesToGif produces a valid GIF89a with one frame per source image', async () => {
  const frames = await Promise.all([
    tmpSolidColorPng(4, 4, 0xff0000ff),
    tmpSolidColorPng(4, 4, 0x00ff00ff),
    tmpSolidColorPng(4, 4, 0x0000ffff),
  ]);

  const gifBytes = await encodeFramesToGif(frames, 6);

  assert.equal(gifBytes.subarray(0, 6).toString('ascii'), 'GIF89a');
  const blocks = readGraphicControlExtensions(gifBytes);
  assert.equal(blocks.length, 3);
});

test('encodeFramesToGif stores the delay implied by fps, in GIF centiseconds', async () => {
  const frames = await Promise.all([tmpSolidColorPng(2, 2, 0xff0000ff), tmpSolidColorPng(2, 2, 0x00ff00ff)]);

  const gifBytes = await encodeFramesToGif(frames, 6);

  // fps=6 -> 1000/6 = 166.67ms/frame -> gifenc rounds to 167ms -> GIF stores
  // centiseconds: round(167/10) = 17.
  const expectedCentiseconds = Math.round(Math.round(1000 / 6) / 10);
  const blocks = readGraphicControlExtensions(gifBytes);
  assert.ok(blocks.length > 0);
  for (const block of blocks) {
    assert.equal(block.delayCentiseconds, expectedCentiseconds);
  }
});

test('encodeFramesToGif rejects invalid inputs before doing any decoding work', async () => {
  await assert.rejects(() => encodeFramesToGif([tmpFileOfSize(100)], 6), GifEncodingError);
});
