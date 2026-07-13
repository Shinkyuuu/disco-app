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

// Pure mapping from a resolved profile + current mode/speaking state to concrete
// render values. No Electron dependency - unit-tested like backoff.js/protocolUrl.js.
export function resolveAppearance({ avatarMode, isSpeaking, discordAvatarURL, profile }) {
  const avatarSrc =
    avatarMode === 'discord'
      ? discordAvatarURL
      : (isSpeaking ? profile.avatarSpeaking ?? profile.avatarSilent : profile.avatarSilent) ?? discordAvatarURL;
  return {
    avatarSrc,
    usernameColor: profile.usernameColor ?? null,
    chatColor: profile.chatColor ?? null,
  };
}
