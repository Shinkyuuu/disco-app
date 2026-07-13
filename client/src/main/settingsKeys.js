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

// The renderer-facing keys `set-settings` is allowed to write. Deliberately
// excludes sessionToken/loggedInUserId (only main sets these, via the OAuth
// deep-link/exchange flow) and defaultProfiles/friendProfiles/chatWindowWidth/
// chatWindowPanelHeight (owned by profiles.js's dedicated IPC handlers and the
// chat window's own resize listener, respectively) - without this allowlist a
// compromised renderer could otherwise set-settings its way into overwriting
// any of those directly.
export const SETTABLE_KEYS = new Set([
  'avatarMode',
  'avatarSize',
  'chatSize',
  'chatOpacity',
  'chatCollapsed',
  'chatLocked',
  'chatAutoWidth',
  'chatFontFamily',
  'chatBorderStyle',
  'betaUpdates',
]);

export function sanitizeSettingsPatch(partial) {
  const result = {};
  for (const [key, value] of Object.entries(partial)) {
    if (SETTABLE_KEYS.has(key)) result[key] = value;
  }
  return result;
}
