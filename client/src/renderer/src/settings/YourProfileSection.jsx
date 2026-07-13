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

import ProfileFieldsEditor from './ProfileFieldsEditor';
import { colorsOf } from './profileColors';

// Mechanically a friend profile keyed by loggedInUserId, given pinned styling.
export default function YourProfileSection({ loggedInUserId, profile, onChange }) {
  if (!loggedInUserId) {
    return (
      <>
        <h3 className="settings-heading settings-heading--profile">Your Profile</h3>
        <section className="settings-section your-profile your-profile--disabled">
          <p className="settings-subtext">Log in to configure your own profile.</p>
        </section>
      </>
    );
  }

  const current = profile ?? { avatarSilent: null, avatarSpeaking: null, usernameColor: null, chatColor: null };
  async function update(mutate) {
    await mutate();
    onChange();
  }

  return (
    <>
      <h3 className="settings-heading settings-heading--profile">Your Profile</h3>
      <section className="settings-section your-profile">
        <ProfileFieldsEditor
          layout="card"
          profile={current}
          onPickAvatar={(kind) => update(() => window.api.pickFriendAvatarImage(loggedInUserId, kind))}
          onClearAvatar={(kind) => update(() => window.api.clearFriendAvatarImage(loggedInUserId, kind))}
          onSetColor={(field, value) =>
            update(() => window.api.setFriendProfileColors(loggedInUserId, { ...colorsOf(current), [field]: value }))
          }
          onClearColor={(field) =>
            update(() => window.api.setFriendProfileColors(loggedInUserId, { ...colorsOf(current), [field]: null }))
          }
        />
      </section>
    </>
  );
}
