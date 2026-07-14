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

// Pure sizing/positioning math for the error toast window, kept separate
// from index.js so it's testable without Electron's app lifecycle (see
// chatWindowSize.js / chatMenuPosition.js for the same reasoning).

export const TOAST_WIDTH = 320;
export const TOAST_HEIGHT = 64;
const TOAST_MARGIN = 8;

// Centers the toast just above the chat window, flipping to just below it if
// there isn't room above within the work area. Falls back to a fixed corner
// of the work area when there's no chat window open at all - the chat
// window can be fully closed while wsClient (and thus errors) keep running
// in the background.
export function toastPositionFor(chatWindowBounds, workArea) {
  if (!chatWindowBounds) {
    return { x: workArea.x + workArea.width - TOAST_WIDTH - 16, y: workArea.y + 16 };
  }
  const x = Math.min(
    Math.max(Math.round(chatWindowBounds.x + (chatWindowBounds.width - TOAST_WIDTH) / 2), workArea.x),
    workArea.x + workArea.width - TOAST_WIDTH,
  );
  const opensBelow = chatWindowBounds.y - TOAST_HEIGHT - TOAST_MARGIN < workArea.y;
  const y = opensBelow
    ? Math.round(chatWindowBounds.y + chatWindowBounds.height + TOAST_MARGIN)
    : Math.round(chatWindowBounds.y - TOAST_HEIGHT - TOAST_MARGIN);
  return { x, y };
}
