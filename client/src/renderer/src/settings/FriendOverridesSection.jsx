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
import ProfileFieldsEditor from './ProfileFieldsEditor';
import { colorsOf } from './profileColors';

// Drawn as crossed lines (not a "×" glyph) so it sits pixel-centered in the
// button regardless of font metrics - see TitleBar.jsx's CloseIcon.
function RemoveIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.4" />
      <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export default function FriendOverridesSection({ friends, onChange }) {
  const [newId, setNewId] = useState('');

  async function update(mutate) {
    await mutate();
    onChange();
  }

  async function addFriend() {
    const id = newId.trim();
    if (!id) return;
    await window.api.addFriendProfile(id);
    setNewId('');
    onChange();
  }

  return (
    <>
      <h3 className="settings-heading">Friend Overrides</h3>
      <section className="settings-section">
        <div className="friend-cards">
          {Object.entries(friends).map(([userId, profile]) => (
            <div key={userId} className="friend-card">
              <button
                className="friend-remove"
                aria-label="Remove friend profile"
                onClick={() => update(() => window.api.removeFriendProfile(userId))}
              >
                <RemoveIcon />
              </button>
              <div className="friend-id">{userId}</div>
              <ProfileFieldsEditor
                layout="card"
                profile={profile}
                onPickAvatar={(kind) => update(() => window.api.pickFriendAvatarImage(userId, kind))}
                onClearAvatar={(kind) => update(() => window.api.clearFriendAvatarImage(userId, kind))}
                onPickFrames={window.api.pickFrameSourceImages}
                onSaveFrames={(frameFilePaths, fps) => update(() => window.api.saveFriendFramesAvatar(userId, frameFilePaths, fps))}
                onSetSpeakingType={(type) => update(() => window.api.setFriendAvatarType(userId, type))}
                onSetColor={(field, value) =>
                  update(() => window.api.setFriendProfileColors(userId, { ...colorsOf(profile), [field]: value }))
                }
                onClearColor={(field) =>
                  update(() => window.api.setFriendProfileColors(userId, { ...colorsOf(profile), [field]: null }))
                }
              />
            </div>
          ))}
          <div className="friend-card friend-card--add">
            <div className="friend-id">Add friend profile</div>
            <div className="friend-add-row">
              <input
                placeholder="Discord user ID"
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addFriend()}
              />
              <button onClick={addFriend}>+ Add</button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
