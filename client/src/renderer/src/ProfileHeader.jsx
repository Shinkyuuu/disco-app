import { resolveAppearance } from './resolveAppearance';
import SpeechBubble from './SpeechBubble';

const STATUS_COLORS = {
  online: '#23a55a',
  idle: '#f0b232',
  dnd: '#f23f43',
  offline: '#80848e',
};

const EMPTY_PEEK_PROFILE = { avatarSilent: null, avatarSpeaking: null, usernameColor: null, chatColor: null };

export default function ProfileHeader({ profile, reachable, avatarMode, peekProfile }) {
  if (!reachable) {
    return (
      <div className="profile-header">
        <span className="status-spinner" aria-hidden="true" />
        <p className="profile-header-status">Server unreachable - retrying…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="profile-header">
        <p className="profile-header-status">Not found in the Discord server</p>
      </div>
    );
  }

  const dotColor = STATUS_COLORS[profile.discordStatus] ?? STATUS_COLORS.offline;
  const { avatarSrc: peekAvatarSrc } = resolveAppearance({
    avatarMode,
    isSpeaking: false,
    discordAvatarURL: profile.avatarURL,
    profile: peekProfile ?? EMPTY_PEEK_PROFILE,
  });
  const isPeeking = avatarMode === 'custom' && Boolean((peekProfile ?? EMPTY_PEEK_PROFILE).avatarSilent);

  return (
    <div
      className={`profile-header-block${
        isPeeking ? ' profile-header-block--peeking' : avatarMode === 'custom' ? ' profile-header-block--custom' : ''
      }`}
    >
      {isPeeking && <img className="profile-peek-avatar" src={peekAvatarSrc} alt="" />}
      {avatarMode === 'custom' && <SpeechBubble />}
      <div className="profile-header">
        <img
          className="profile-header-avatar"
          src={profile.avatarURL}
          alt=""
          style={{ borderColor: dotColor }}
        />
        <div className="profile-header-info">
          <div className="profile-header-name">
            <span className="status-dot" style={{ background: dotColor }} />
            {profile.username}
          </div>
          <p className="profile-header-id">{profile.userId}</p>
          <span
            className={`profile-header-tag ${
              profile.inTrackedChannel ? 'profile-header-tag--active' : 'profile-header-tag--inactive'
            }`}
          >
            {profile.inTrackedChannel ? 'In voice channel' : 'Not in voice channel'}
          </span>
        </div>
      </div>
    </div>
  );
}
