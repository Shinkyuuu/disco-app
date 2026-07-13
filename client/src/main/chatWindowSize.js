// Pure window-sizing math for the chat overlay window, kept separate from
// index.js so it's testable without pulling in Electron's app lifecycle
// side effects (index.js has none of those guards, so importing it directly
// in a test would run them).

export const CHAT_PANEL_HEIGHT = 324;
export const HEADER_HEIGHT_BY_AVATAR_SIZE = { small: 158, medium: 221, large: 281 };
// Discord-mode avatars are shorter/rounder than custom-image portraits and
// don't bleed below the header, so they need much less top headroom to clear
// the username label and the speaking-glow's blur/scale bleed - see the
// matching .chat-header--discord heights in app.css.
export const HEADER_HEIGHT_BY_AVATAR_SIZE_DISCORD = { small: 124, medium: 160, large: 196 };
export const MIN_CHAT_PANEL_HEIGHT = 100;

function headerHeightFor(avatarSize, avatarMode) {
  const table = avatarMode === 'discord' ? HEADER_HEIGHT_BY_AVATAR_SIZE_DISCORD : HEADER_HEIGHT_BY_AVATAR_SIZE;
  return table[avatarSize] ?? table.small;
}

// Total chat window height: the avatar header (grows with avatar size) plus
// the full message panel - or, when collapsed, nothing extra at all, so the
// window is exactly the header (avatars + the floating ⋯ button).
export function chatWindowHeightFor(avatarSize, { collapsed = false, panelHeight = CHAT_PANEL_HEIGHT, avatarMode } = {}) {
  const headerHeight = headerHeightFor(avatarSize, avatarMode);
  return collapsed ? headerHeight : headerHeight + panelHeight;
}

export { headerHeightFor };

// Avatar box widths per avatar size - keep in sync with .speaker-icon--discord
// / .speaker-icon--custom in SpeakerStrip.css. Custom-mode portraits are
// wider rectangles than the round discord avatars, hence the separate table
// (same distinction as HEADER_HEIGHT_BY_AVATAR_SIZE / _DISCORD above).
export const AVATAR_WIDTH_BY_SIZE = { small: 96, medium: 146, large: 194 };
export const AVATAR_WIDTH_BY_SIZE_DISCORD = { small: 73, medium: 102, large: 130 };
// .speaker-strip's gap, per avatar size - see SpeakerStrip.css.
export const AVATAR_GAP_BY_SIZE = { small: 8, medium: 10, large: 12 };
// .chat-header's left+right padding in app.css (16px each side) - the avatar
// row's horizontal breathing room the window width also has to include.
const HEADER_HORIZONTAL_PADDING = 32;
export const MIN_CHAT_WINDOW_WIDTH = 300;
// The floating ⋯ menu button (.window-menu in app.css) is positioned
// left:6px against the window's own left edge, independent of the avatar
// strip - .chat-header's extra left padding (see app.css) reserves this much
// additional room to its right. Deliberately kept smaller than the button's
// own footprint so the first avatar overlaps it slightly rather than leaving
// a visible gap.
const MENU_BUTTON_CLEARANCE = 12;

// Chat window width for the auto-width setting: exactly wide enough to fit
// every avatar in the roster's single-row strip (see SpeakerStrip.jsx) side
// by side, so nobody is clipped by the window's own bounds - Electron clips
// all rendered content to a window's rect regardless of CSS overflow, so this
// has to be computed rather than left to flex-wrap/overflow.
export function chatWindowWidthFor(rosterSize, avatarSize, avatarMode) {
  const widthTable = avatarMode === 'discord' ? AVATAR_WIDTH_BY_SIZE_DISCORD : AVATAR_WIDTH_BY_SIZE;
  const avatarWidth = widthTable[avatarSize] ?? widthTable.small;
  const gap = AVATAR_GAP_BY_SIZE[avatarSize] ?? AVATAR_GAP_BY_SIZE.small;
  const n = Math.max(rosterSize, 0);
  const rowWidth = n * avatarWidth + Math.max(n - 1, 0) * gap;
  return Math.max(rowWidth + HEADER_HORIZONTAL_PADDING + MENU_BUTTON_CLEARANCE, MIN_CHAT_WINDOW_WIDTH);
}
