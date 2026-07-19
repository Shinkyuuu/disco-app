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
import SpeakingAvatarField from './SpeakingAvatarField';
import ColorField from './ColorField';

// One editor, two call sites (each Default Slot row, each Friend card).
// Silent uses AvatarField directly; Speaking uses SpeakingAvatarField (the
// Image/GIF/Frames tab bar).

export default function ProfileFieldsEditor({
  layout,
  profile,
  onPickAvatar,
  onClearAvatar,
  onPickFrames,
  onSaveFrames,
  onSetSpeakingType,
  onSetColor,
  onClearColor,
}) {
  return (
    <div className={`profile-fields profile-fields--${layout}`}>
      <div className="pf-avatars">
        <AvatarField
          label="Silent"
          src={profile.avatarSilent}
          onPick={() => onPickAvatar('silent')}
          onClear={() => onClearAvatar('silent')}
        />
        <SpeakingAvatarField
          variants={profile.speakingVariants}
          onPickImage={() => onPickAvatar('speaking-image')}
          onPickGif={() => onPickAvatar('speaking-gif')}
          onPickFrames={onPickFrames}
          onSaveFrames={onSaveFrames}
          onSetActiveType={onSetSpeakingType}
          onClearImage={() => onClearAvatar('speaking-image')}
          onClearGif={() => onClearAvatar('speaking-gif')}
          onClearFrames={() => onClearAvatar('speaking-frames')}
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
