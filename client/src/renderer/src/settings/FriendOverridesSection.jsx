import { useState } from 'react';
import ProfileFieldsEditor from './ProfileFieldsEditor';

function colorsOf(profile) {
  return { usernameColor: profile.usernameColor, chatColor: profile.chatColor };
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
                Remove
              </button>
              <div className="friend-id">{userId}</div>
              <ProfileFieldsEditor
                layout="card"
                profile={profile}
                onPickAvatar={(kind) => update(() => window.api.pickFriendAvatarImage(userId, kind))}
                onClearAvatar={(kind) => update(() => window.api.clearFriendAvatarImage(userId, kind))}
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
