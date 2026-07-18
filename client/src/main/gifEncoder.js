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

import fs from 'node:fs';
import { Jimp } from 'jimp';
import gifenc from 'gifenc';

// gifenc's published package has no "exports" map and ships a minified/bundled
// CJS `main` file, which Node's cjs-module-lexer cannot statically analyze for
// named exports - only a default export is available via ESM, so destructure
// the real named exports from it here instead of `import { X } from 'gifenc'`.
const { GIFEncoder, quantize, applyPalette } = gifenc;

export class GifEncodingError extends Error {}

export const MIN_FRAMES = 2;
export const MAX_FRAMES = 30;
export const MAX_FRAME_BYTES = 2 * 1024 * 1024; // 2MB
export const MIN_FPS = 1;
export const MAX_FPS = 30;

export function validateFrameInputs(frameFilePaths, fps) {
  const count = frameFilePaths?.length ?? 0;
  if (!Array.isArray(frameFilePaths) || count < MIN_FRAMES || count > MAX_FRAMES) {
    throw new GifEncodingError(`Frame count must be between ${MIN_FRAMES} and ${MAX_FRAMES}, got ${count}`);
  }
  if (!Number.isInteger(fps) || fps < MIN_FPS || fps > MAX_FPS) {
    throw new GifEncodingError(`fps must be an integer between ${MIN_FPS} and ${MAX_FPS}, got ${fps}`);
  }
  for (const filePath of frameFilePaths) {
    const { size } = fs.statSync(filePath);
    if (size > MAX_FRAME_BYTES) {
      throw new GifEncodingError(`Frame ${filePath} is ${size} bytes, exceeding the ${MAX_FRAME_BYTES}-byte limit`);
    }
  }
}

// Encodes an ordered list of still images into a single animated GIF, played
// at `fps`. Runs only when a user saves a Frames avatar set in Settings -
// never on the caption-rendering hot path - so its cost (decode + 256-color
// quantize per frame) doesn't touch this app's speed priority. First frame's
// dimensions are used for every frame (later frames are resized to match).
export async function encodeFramesToGif(frameFilePaths, fps) {
  validateFrameInputs(frameFilePaths, fps);

  const images = await Promise.all(frameFilePaths.map((filePath) => Jimp.read(filePath)));
  const { width, height } = images[0].bitmap;

  const gif = GIFEncoder();
  const delay = Math.round(1000 / fps); // gifenc takes milliseconds, converts to GIF centiseconds internally
  for (const image of images) {
    image.resize({ w: width, h: height });
    // gifenc's quantize() does `new Uint32Array(rgba.buffer)`, which reads the
    // *entire* underlying ArrayBuffer and ignores byteOffset/byteLength. Jimp's
    // resize() can return bitmap.data as a view into Node's shared Buffer pool
    // with a nonzero byteOffset, which would make quantize() read unrelated
    // pooled memory as pixel data. Copying into a fresh, exactly-sized
    // Uint8Array (byteOffset 0) avoids that.
    const data = new Uint8Array(image.bitmap.data);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, width, height, { palette, delay });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}
