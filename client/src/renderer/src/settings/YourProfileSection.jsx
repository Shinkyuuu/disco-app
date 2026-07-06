import ProfileFieldsEditor from './ProfileFieldsEditor';

function colorsOf(profile) {
  return { usernameColor: profile.usernameColor, chatColor: profile.chatColor };
}

// Mechanically a friend profile keyed by loggedInUserId, given pinned styling.
export default function YourProfileSection({ loggedInUserId, profile, onChange }) {
  if (!loggedInUserId) {
    return (
      <>
        <h3 className="settings-heading">Your Profile</h3>
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
      <h3 className="settings-heading">Your Profile</h3>
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
