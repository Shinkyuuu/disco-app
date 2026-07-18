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
