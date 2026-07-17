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

// Pure sizing/positioning math for the ⋯ menu's popup window, kept separate
// from index.js so it's testable without Electron's app lifecycle (see
// chatWindowSize.js for the same reasoning).

// The dropdown itself is a fixed-width box (see .window-menu-dropdown in
// app.css); the popup window is wider than that to leave room on the right
// for the avatar-size/chat-size submenus, which open further right on hover.
export const MENU_POPUP_WIDTH = 270;

// Generously-rounded row heights matching the CSS (.window-menu-item,
// .window-menu-slider-item) - a little too tall just leaves harmless
// transparent slack in the popup window; too short would clip the menu, so
// round up rather than measure exactly.
const MENU_ROW_HEIGHT = 34;
const MENU_OPACITY_ROW_HEIGHT = 60;
const MENU_BASE_PADDING = 8;
// Matching .window-menu-label/.window-menu-separator in app.css - the ⋯ menu
// groups its items under labeled sub-groups (see ChatMenuView), each of which
// adds its own label row, and adjacent groups are divided by a separator.
const MENU_LABEL_HEIGHT = 22;
const MENU_SEPARATOR_HEIGHT = 9;

// Which optional sections a given ⋯ menu invocation includes - mirrors which
// props WindowMenu was given, since that already reflects the app's current
// state (e.g. error screens pass none of these, leaving only Exit).
export function chatMenuHeightFor(sections) {
  const hasChatboxGroup = sections.avatarSize || sections.chatSize || sections.opacity || sections.collapse;
  const hasOverlayGroup = sections.pin || sections.lock || sections.autoWidth || sections.snapToEdge;

  // General (Exit) is always present, so its label always renders.
  let height = MENU_BASE_PADDING + MENU_ROW_HEIGHT + MENU_LABEL_HEIGHT;
  if (sections.avatarSize) height += MENU_ROW_HEIGHT;
  if (sections.chatSize) height += MENU_ROW_HEIGHT;
  if (sections.opacity) height += MENU_OPACITY_ROW_HEIGHT;
  if (sections.pin) height += MENU_ROW_HEIGHT;
  if (sections.collapse) height += MENU_ROW_HEIGHT;
  if (sections.lock) height += MENU_ROW_HEIGHT;
  if (sections.autoWidth) height += MENU_ROW_HEIGHT;
  if (sections.snapToEdge) height += MENU_ROW_HEIGHT;
  if (hasChatboxGroup) height += MENU_LABEL_HEIGHT;
  if (hasOverlayGroup) height += MENU_LABEL_HEIGHT;
  if (hasChatboxGroup && hasOverlayGroup) height += MENU_SEPARATOR_HEIGHT;
  if (hasChatboxGroup || hasOverlayGroup) height += MENU_SEPARATOR_HEIGHT;
  return height;
}

// Left-aligns the popup to the ⋯ button's left edge (matching the ⋯ button's
// own left:0 anchoring) and opens it downward unless there isn't room in the
// work area, in which case it opens upward instead - the popup is independent
// of the main chat window, so it's always safe to move.
export function chatMenuPositionFor(anchor, size, workArea) {
  const x = Math.min(
    Math.max(Math.round(anchor.x), workArea.x),
    workArea.x + workArea.width - size.width,
  );
  const opensBelow = anchor.y + anchor.height + size.height <= workArea.y + workArea.height;
  const y = opensBelow ? Math.round(anchor.y + anchor.height) : Math.round(anchor.y - size.height);
  return { x, y, opensBelow };
}
