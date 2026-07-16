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

// Colors apply the same tier order regardless of avatarMode: a friend
// override always wins; otherwise the speaker's own broadcast color (if
// they've set one) beats the viewer's local default-slot color.
export function resolveProfileColors({ profile, broadcastUsernameColor, broadcastChatColor }) {
  const usernameColor = profile.isFriendOverride
    ? (profile.usernameColor ?? null)
    : (broadcastUsernameColor ?? profile.usernameColor ?? null);
  const chatColor = profile.isFriendOverride
    ? (profile.chatColor ?? null)
    : (broadcastChatColor ?? profile.chatColor ?? null);
  return { usernameColor, chatColor };
}

export function resolveAppearance({ avatarMode, isSpeaking, discordAvatarURL, profile, customAvatarSilentURL, customAvatarSpeakingURL, broadcastUsernameColor, broadcastChatColor }) {
  const { usernameColor, chatColor } = resolveProfileColors({ profile, broadcastUsernameColor, broadcastChatColor });

  if (avatarMode === 'discord') {
    return { avatarSrc: discordAvatarURL, usernameColor, chatColor };
  }

  // profile.avatarSilent/avatarSpeaking came from resolveSpeakerProfile, which
  // returns either a friend override OR a generic default-slot image - never
  // both. isFriendOverride distinguishes which, so the broadcast avatar (this
  // speaker's own upload) can be ranked between them: friend override wins,
  // but a broadcast avatar still beats a merely-generic default-slot image.
  //
  // Each tier resolves its OWN silent/speaking pair first (falling back to
  // its own other state if the current one is missing) before precedence
  // moves to the next tier - a tier with only one state set must still beat
  // a lower tier's same-state image, not lose to it.
  function tierValue(silentVal, speakingVal) {
    const primary = isSpeaking ? speakingVal : silentVal;
    const fallback = isSpeaking ? silentVal : speakingVal;
    return primary ?? fallback ?? null;
  }

  const friendValue = profile.isFriendOverride ? tierValue(profile.avatarSilent, profile.avatarSpeaking) : null;
  const broadcastValue = tierValue(customAvatarSilentURL, customAvatarSpeakingURL);
  const defaultValue = profile.isFriendOverride ? null : tierValue(profile.avatarSilent, profile.avatarSpeaking);

  return {
    avatarSrc: friendValue ?? broadcastValue ?? defaultValue ?? discordAvatarURL,
    usernameColor,
    chatColor,
  };
}
