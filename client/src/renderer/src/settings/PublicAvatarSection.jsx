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
import SpeakingAvatarField from './SpeakingAvatarField';
import ColorField from './ColorField';
import { colorsOf } from './profileColors';

const EMPTY_VARIANTS = { activeType: null, image: null, gif: null, frames: null };

// Uploads/clears the avatar broadcast to OTHER viewers (server-backed, via
// AWS S3/CloudFront). Colors below are broadcast the same way - every write
// updates both the local friendProfiles entry (so the local user's own view
// updates immediately) and the server-side manifest (so other viewers see it
// too, unless they've set their own friend override for this user).
export default function PublicAvatarSection({ loggedInUserId, profile, onChange }) {
  const [silentURL, setSilentURL] = useState(null);
  const [speakingVariants, setSpeakingVariants] = useState(EMPTY_VARIANTS);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null); // 'silent' | 'image' | 'gif' | 'frames' | null
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!loggedInUserId) return;
    window.api.getBroadcastAvatar()
      .then(({ silentURL, speakingVariants }) => {
        setSilentURL(silentURL ?? null);
        setSpeakingVariants(speakingVariants ?? EMPTY_VARIANTS);
        setLoaded(true);
      })
      .catch((err) => {
        setError(`Failed to load current avatar: ${err.message}`);
        setLoaded(true);
      });
  }, [loggedInUserId]);

  if (!loggedInUserId) {
    return (
      <>
        <h3 className="settings-heading">Public Avatar</h3>
        <section className="settings-section your-profile your-profile--disabled">
          <p className="settings-subtext">Log in to configure the avatar other viewers see.</p>
        </section>
      </>
    );
  }

  async function handlePickSilent() {
    setPending('silent');
    setError(null);
    try {
      const avatarUrl = await window.api.uploadBroadcastAvatar('silent');
      if (avatarUrl) setSilentURL(avatarUrl);
    } catch (err) {
      setError(`Failed to upload silent avatar: ${err.message}`);
    } finally {
      setPending(null);
    }
  }

  async function handleClearSilent() {
    setPending('silent');
    setError(null);
    try {
      await window.api.clearBroadcastAvatar('silent');
      setSilentURL(null);
    } catch (err) {
      setError(`Failed to clear silent avatar: ${err.message}`);
    } finally {
      setPending(null);
    }
  }

  async function handlePickSpeaking(variantKind, type) {
    setPending(type);
    setError(null);
    try {
      const avatarUrl = await window.api.uploadBroadcastAvatar(variantKind);
      if (avatarUrl) setSpeakingVariants((prev) => ({ ...prev, [type]: avatarUrl, activeType: type }));
    } catch (err) {
      setError(`Failed to upload speaking ${type}: ${err.message}`);
    } finally {
      setPending(null);
    }
  }

  async function handleSaveFrames(frameFilePaths, fps) {
    setPending('frames');
    setError(null);
    try {
      const avatarUrl = await window.api.uploadBroadcastFramesAvatar(frameFilePaths, fps);
      setSpeakingVariants((prev) => ({ ...prev, frames: { url: avatarUrl, fps, frameCount: frameFilePaths.length }, activeType: 'frames' }));
    } catch (err) {
      setError(`Failed to upload frames: ${err.message}`);
      throw err;
    } finally {
      setPending(null);
    }
  }

  // Rethrows on failure (unlike handlePickSpeaking/handleClearSpeaking above)
  // so SpeakingAvatarField's selectTab can revert the optimistically-switched
  // tab back to the real active type - see Task 2's selectTab.
  async function handleSetActiveType(type) {
    setPending(type);
    setError(null);
    try {
      await window.api.setBroadcastSpeakingType(type);
      setSpeakingVariants((prev) => ({ ...prev, activeType: type }));
    } catch (err) {
      setError(`Failed to switch speaking avatar: ${err.message}`);
      throw err;
    } finally {
      setPending(null);
    }
  }

  async function handleClearSpeaking(type) {
    setPending(type);
    setError(null);
    try {
      await window.api.clearBroadcastAvatar(`speaking-${type}`);
      setSpeakingVariants((prev) => ({ ...prev, [type]: null, activeType: prev.activeType === type ? null : prev.activeType }));
    } catch (err) {
      setError(`Failed to clear speaking ${type}: ${err.message}`);
    } finally {
      setPending(null);
    }
  }

  const currentColors = profile ?? { usernameColor: null, chatColor: null };

  async function updateColor(field, value) {
    const next = { ...colorsOf(currentColors), [field]: value };
    setError(null);
    await window.api.setFriendProfileColors(loggedInUserId, next);
    try {
      await window.api.setPublicColors(next);
    } catch (err) {
      setError(`Failed to broadcast color: ${err.message}`);
    }
    onChange();
  }

  return (
    <>
      <h3 className="settings-heading">Public Avatar</h3>
      <section className="settings-section your-profile">
        <p className="settings-subtext">Shown to other viewers in shared voice channels (custom avatar mode only).</p>
        <div className="profile-fields profile-fields--card">
          <div className="pf-avatars">
            <AvatarField
              label="Silent"
              src={silentURL}
              busy={pending === 'silent'}
              onPick={handlePickSilent}
              onClear={handleClearSilent}
            />
            <SpeakingAvatarField
              key={loaded ? 'loaded' : 'loading'}
              variants={speakingVariants}
              busy={Boolean(pending)}
              onPickImage={() => handlePickSpeaking('speaking-image', 'image')}
              onPickGif={() => handlePickSpeaking('speaking-gif', 'gif')}
              onPickFrames={window.api.pickFrameSourceImages}
              onSaveFrames={handleSaveFrames}
              onSetActiveType={handleSetActiveType}
              onClearImage={() => handleClearSpeaking('image')}
              onClearGif={() => handleClearSpeaking('gif')}
              onClearFrames={() => handleClearSpeaking('frames')}
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
