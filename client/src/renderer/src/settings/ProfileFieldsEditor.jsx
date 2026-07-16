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

import AvatarField from './AvatarField';
import ColorField from './ColorField';

// One editor, three call sites (Your Profile card, each Default Slot row, each
// Friend card). Avatar fields come from AvatarField, color fields from
// ColorField.

export default function ProfileFieldsEditor({ layout, profile, onPickAvatar, onClearAvatar, onSetColor, onClearColor }) {
  return (
    <div className={`profile-fields profile-fields--${layout}`}>
      <div className="pf-avatars">
        <AvatarField
          label="Silent"
          src={profile.avatarSilent}
          onPick={() => onPickAvatar('silent')}
          onClear={() => onClearAvatar('silent')}
        />
        <AvatarField
          label="Speaking"
          src={profile.avatarSpeaking}
          onPick={() => onPickAvatar('speaking')}
          onClear={() => onClearAvatar('speaking')}
        />
      </div>
      <div className="pf-colors">
        <ColorField
          label="Name color"
          value={profile.usernameColor}
          onSet={(v) => onSetColor('usernameColor', v)}
          onClear={() => onClearColor('usernameColor')}
          exampleText="Username"
          exampleClassName="message-line-username message-line-username--medium"
        />
        <ColorField
          label="Chat color"
          value={profile.chatColor}
          onSet={(v) => onSetColor('chatColor', v)}
          onClear={() => onClearColor('chatColor')}
          exampleText="This is what your captions will look like."
          exampleClassName="message-line-text message-line-text--medium"
        />
      </div>
    </div>
  );
}
