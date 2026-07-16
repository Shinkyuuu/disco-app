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

import alienSilent from './assets/alien-silent.png';
import SpeechBubble from './SpeechBubble';

const EMPTY_PEEK_PROFILE = { avatarSilent: null, avatarSpeaking: null, usernameColor: null, chatColor: null };

// Not a fixed app mascot - a preview of the logged-in user's own custom
// avatar (avatarMode: 'custom'). Falls back from silent -> speaking -> the
// bundled mascot image, so the companion always has something to show.
export default function ProfileCompanion({ avatarMode, peekProfile }) {
  if (avatarMode !== 'custom') return null;

  const profile = peekProfile ?? EMPTY_PEEK_PROFILE;
  const avatarSrc = profile.avatarSilent ?? profile.avatarSpeaking ?? alienSilent;

  return (
    <div className="profile-companion">
      <img className="profile-companion-avatar" src={avatarSrc} alt="" />
      <SpeechBubble />
    </div>
  );
}
