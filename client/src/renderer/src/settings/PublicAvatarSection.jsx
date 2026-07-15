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

import { useState } from 'react';

// Uploads/clears the avatar broadcast to OTHER viewers (server-backed, via
// AWS S3/CloudFront) - distinct from YourProfileSection, which only affects
// how you locally see yourself and never leaves this machine.
export default function PublicAvatarSection({ loggedInUserId }) {
  const [images, setImages] = useState({ silent: null, speaking: null });
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null); // 'silent' | 'speaking' | null

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

  return (
    <>
      <h3 className="settings-heading settings-heading--profile">Public Avatar</h3>
      <section className="settings-section your-profile">
        <p className="settings-subtext">Shown to other viewers in shared voice channels (custom avatar mode only).</p>
        {['silent', 'speaking'].map((kind) => (
          <div key={kind} className="settings-field">
            <span>{kind === 'silent' ? 'Silent image' : 'Speaking image'}</span>
            {images[kind] && <img src={images[kind]} alt={`${kind} preview`} width={48} height={48} />}
            <button type="button" disabled={pending === kind} onClick={() => handlePick(kind)}>
              {pending === kind ? 'Working…' : 'Choose image'}
            </button>
            <button type="button" disabled={pending === kind} onClick={() => handleClear(kind)}>
              Clear
            </button>
          </div>
        ))}
        {error && <p className="settings-subtext">{error}</p>}
      </section>
    </>
  );
}
