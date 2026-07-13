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

  return (
    <div className="profile-header">
      <img className="profile-header-avatar" src={profile.avatarURL} alt="" style={{ borderColor: dotColor }} />
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
  );
}
