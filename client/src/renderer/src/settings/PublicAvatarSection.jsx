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

import { useEffect, useState } from 'react';
import AvatarField from './AvatarField';
import ColorField from './ColorField';
import { colorsOf } from './profileColors';

// Uploads/clears the avatar broadcast to OTHER viewers (server-backed, via
// AWS S3/CloudFront). Colors below are local-only (never broadcast) - same
// storage/IPC as any other profile's colors, just edited from this section.
export default function PublicAvatarSection({ loggedInUserId, profile, onChange }) {
  const [images, setImages] = useState({ silent: null, speaking: null });
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null); // 'silent' | 'speaking' | null

  useEffect(() => {
    if (!loggedInUserId) return;
    window.api.getBroadcastAvatar()
      .then(({ silentURL, speakingURL }) => {
        setImages({ silent: silentURL ?? null, speaking: speakingURL ?? null });
      })
      .catch((err) => setError(`Failed to load current avatar: ${err.message}`));
  }, [loggedInUserId]);

  if (!loggedInUserId) {
    return (
      <>
        <h3 className="settings-heading settings-heading--profile">Public Avatar</h3>
        <section className="settings-section your-profile your-profile--disabled">
          <p className="settings-subtext">Log in to configure the avatar other viewers see.</p>
        </section>
      </>
    );
  }

  async function handlePick(kind) {
    setPending(kind);
    setError(null);
    try {
      const avatarUrl = await window.api.uploadBroadcastAvatar(kind);
      if (avatarUrl) setImages((prev) => ({ ...prev, [kind]: avatarUrl }));
    } catch (err) {
      setError(`Failed to upload ${kind} avatar: ${err.message}`);
    } finally {
      setPending(null);
    }
  }

  async function handleClear(kind) {
    setPending(kind);
    setError(null);
    try {
      await window.api.clearBroadcastAvatar(kind);
      setImages((prev) => ({ ...prev, [kind]: null }));
    } catch (err) {
      setError(`Failed to clear ${kind} avatar: ${err.message}`);
    } finally {
      setPending(null);
    }
  }

  const currentColors = profile ?? { usernameColor: null, chatColor: null };

  async function updateColor(field, value) {
    await window.api.setFriendProfileColors(loggedInUserId, { ...colorsOf(currentColors), [field]: value });
    onChange();
  }

  return (
    <>
      <h3 className="settings-heading settings-heading--profile">Public Avatar</h3>
      <section className="settings-section your-profile">
        <p className="settings-subtext">Shown to other viewers in shared voice channels (custom avatar mode only).</p>
        <div className="profile-fields profile-fields--card">
          <div className="pf-avatars">
            <AvatarField
              label="Silent"
              src={images.silent}
              busy={pending === 'silent'}
              onPick={() => handlePick('silent')}
              onClear={() => handleClear('silent')}
            />
            <AvatarField
              label="Speaking"
              src={images.speaking}
              busy={pending === 'speaking'}
              onPick={() => handlePick('speaking')}
              onClear={() => handleClear('speaking')}
            />
          </div>
          <div className="pf-colors">
            <ColorField
              label="Name color"
              value={currentColors.usernameColor}
              onSet={(v) => updateColor('usernameColor', v)}
              onClear={() => updateColor('usernameColor', null)}
              exampleText="Username"
              exampleClassName="message-line-username message-line-username--medium"
            />
            <ColorField
              label="Chat color"
              value={currentColors.chatColor}
              onSet={(v) => updateColor('chatColor', v)}
              onClear={() => updateColor('chatColor', null)}
              exampleText="This is what your captions will look like."
              exampleClassName="message-line-text message-line-text--medium"
            />
          </div>
        </div>
        {error && <p className="settings-subtext">{error}</p>}
      </section>
    </>
  );
}
