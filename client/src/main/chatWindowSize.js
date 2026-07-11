// Pure window-sizing math for the chat overlay window, kept separate from
// index.js so it's testable without pulling in Electron's app lifecycle
// side effects (index.js has none of those guards, so importing it directly
// in a test would run them).

export const CHAT_WINDOW_WIDTH = 480;
export const CHAT_PANEL_HEIGHT = 324;
export const HEADER_HEIGHT_BY_AVATAR_SIZE = { small: 158, medium: 221, large: 281 };
export const MIN_CHAT_PANEL_HEIGHT = 100;
export const THIN_BAR_HEIGHT = 18;

// Total chat window height: the avatar header (grows with avatar size) plus
// either the full message panel or, when collapsed, a fixed-height thin bar.
export function chatWindowHeightFor(avatarSize, { collapsed = false, panelHeight = CHAT_PANEL_HEIGHT } = {}) {
  const headerHeight = HEADER_HEIGHT_BY_AVATAR_SIZE[avatarSize] ?? HEADER_HEIGHT_BY_AVATAR_SIZE.small;
  return headerHeight + (collapsed ? THIN_BAR_HEIGHT : panelHeight);
}
