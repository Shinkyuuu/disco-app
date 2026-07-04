const STATUS_COLORS = {
  online: '#23a55a',
  idle: '#f0b232',
  dnd: '#f23f43',
  offline: '#80848e',
};

export default function ProfileHeader({ profile, reachable }) {
  if (!reachable) {
    return (
      <div className="profile-header">
        <p className="profile-header-status">Server unreachable</p>
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

  return (
    <div className="profile-header">
      <img className="profile-header-avatar" src={profile.avatarURL} alt="" />
      <div className="profile-header-info">
        <div className="profile-header-name">
          <span className="status-dot" style={{ background: dotColor }} />
          {profile.username}
        </div>
        <p className="profile-header-id">{profile.userId}</p>
        <p className="profile-header-badge">
          {profile.inTrackedChannel ? 'In voice channel' : 'Not in voice channel'}
        </p>
      </div>
    </div>
  );
}
