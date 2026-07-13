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

import { resolveAppearance } from './resolveAppearance';
import SpeechBubble from './SpeechBubble';

const EMPTY_PEEK_PROFILE = { avatarSilent: null, avatarSpeaking: null, usernameColor: null, chatColor: null };

// Not a fixed app mascot - a preview of the logged-in user's own custom
// avatar (avatarMode: 'custom'). The speech bubble always shows in custom
// mode; the avatar image only shows once the user has actually set one.
export default function ProfileCompanion({ avatarMode, peekProfile, discordAvatarURL }) {
  if (avatarMode !== 'custom') return null;

  const { avatarSrc: peekAvatarSrc } = resolveAppearance({
    avatarMode,
    isSpeaking: false,
    discordAvatarURL,
    profile: peekProfile ?? EMPTY_PEEK_PROFILE,
  });
  const hasAvatar = Boolean((peekProfile ?? EMPTY_PEEK_PROFILE).avatarSilent);

  return (
    <div className="profile-companion">
      {hasAvatar && <img className="profile-companion-avatar" src={peekAvatarSrc} alt="" />}
      <SpeechBubble />
    </div>
  );
}
