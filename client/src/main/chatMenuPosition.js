// Pure sizing/positioning math for the ⋯ menu's popup window, kept separate
// from index.js so it's testable without Electron's app lifecycle (see
// chatWindowSize.js for the same reasoning).

// The dropdown itself is a fixed-width box (see .window-menu-dropdown in
// app.css); the popup window is wider than that to leave room on the left
// for the avatar-size/chat-size submenus, which open further left on hover.
export const MENU_POPUP_WIDTH = 250;

// Generously-rounded row heights matching the CSS (.window-menu-item,
// .window-menu-slider-item) - a little too tall just leaves harmless
// transparent slack in the popup window; too short would clip the menu, so
// round up rather than measure exactly.
const MENU_ROW_HEIGHT = 34;
const MENU_OPACITY_ROW_HEIGHT = 60;
const MENU_BASE_PADDING = 8;

// Which optional sections a given ⋯ menu invocation includes - mirrors which
// props WindowMenu was given, since that already reflects the app's current
// state (e.g. error screens pass none of these, leaving only Exit).
export function chatMenuHeightFor(sections) {
  let height = MENU_BASE_PADDING + MENU_ROW_HEIGHT; // Exit is always present
  if (sections.avatarSize) height += MENU_ROW_HEIGHT;
  if (sections.chatSize) height += MENU_ROW_HEIGHT;
  if (sections.opacity) height += MENU_OPACITY_ROW_HEIGHT;
  if (sections.pin) height += MENU_ROW_HEIGHT;
  if (sections.collapse) height += MENU_ROW_HEIGHT;
  if (sections.lock) height += MENU_ROW_HEIGHT;
  if (sections.autoWidth) height += MENU_ROW_HEIGHT;
  return height;
}

// Right-aligns the popup to the ⋯ button's right edge (matching the
// dropdown's previous right:0 anchoring) and opens it downward unless there
// isn't room in the work area, in which case it opens upward instead - the
// popup is independent of the main chat window, so it's always safe to move.
export function chatMenuPositionFor(anchor, size, workArea) {
  const x = Math.min(
    Math.max(Math.round(anchor.x + anchor.width - size.width), workArea.x),
    workArea.x + workArea.width - size.width,
  );
  const opensBelow = anchor.y + anchor.height + size.height <= workArea.y + workArea.height;
  const y = opensBelow ? Math.round(anchor.y + anchor.height) : Math.round(anchor.y - size.height);
  return { x, y, opensBelow };
}
