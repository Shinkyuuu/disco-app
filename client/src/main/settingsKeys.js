// The renderer-facing keys `set-settings` is allowed to write. Deliberately
// excludes sessionToken/loggedInUserId (only main sets these, via the OAuth
// deep-link/exchange flow) and defaultProfiles/friendProfiles/chatWindowWidth/
// chatWindowPanelHeight (owned by profiles.js's dedicated IPC handlers and the
// chat window's own resize listener, respectively) - without this allowlist a
// compromised renderer could otherwise set-settings its way into overwriting
// any of those directly.
export const SETTABLE_KEYS = new Set([
  'serverAddress',
  'avatarMode',
  'avatarSize',
  'chatSize',
  'chatOpacity',
  'chatCollapsed',
  'chatLocked',
  'chatAutoWidth',
  'chatFontFamily',
  'chatBorderStyle',
]);

export function sanitizeSettingsPatch(partial) {
  const result = {};
  for (const [key, value] of Object.entries(partial)) {
    if (SETTABLE_KEYS.has(key)) result[key] = value;
  }
  return result;
}
