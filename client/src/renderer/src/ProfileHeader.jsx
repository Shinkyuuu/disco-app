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

const STATUS_COLORS = {
  online: '#23a55a',
  idle: '#f0b232',
  dnd: '#f23f43',
  offline: '#80848e',
};

function SpeakerIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1 3.5H2.8L5 1.5V8.5L2.8 6.5H1V3.5Z" fill="currentColor" />
      <path
        d="M6.7 3C7.2 3.5 7.2 6.5 6.7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SpeakerMutedIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1 3.5H2.8L5 1.5V8.5L2.8 6.5H1V3.5Z" fill="currentColor" />
      <line x1="6.5" y1="3" x2="9.5" y2="7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <line x1="9.5" y1="3" x2="6.5" y2="7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="3" y="3" width="6" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M2 6.5V2C2 1.5 2.5 1 3 1H7" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1.5 5.2L4 7.7L8.5 2.7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ProfileHeader({ profile, reachable }) {
  const [copied, setCopied] = useState(false);

  const handleCopyId = () => {
    navigator.clipboard.writeText(profile.userId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

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
      <div className="profile-header-avatar-wrap">
        <img className="profile-header-avatar" src={profile.avatarURL} alt="" style={{ borderColor: dotColor }} />
        <span className="status-dot" style={{ background: dotColor }} />
      </div>
      <div className="profile-header-info">
        <div className="profile-header-name">
          {profile.username}
        </div>
        <p className="profile-header-id">
          <span className="profile-header-id-text">{profile.userId}</span>
          <button
            type="button"
            className="profile-header-id-copy"
            aria-label="Copy user ID"
            onClick={handleCopyId}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </p>
        <span
          className={`profile-header-tag ${
            profile.inTrackedChannel ? 'profile-header-tag--active' : 'profile-header-tag--inactive'
          }`}
        >
          {profile.inTrackedChannel ? <SpeakerIcon /> : <SpeakerMutedIcon />}
          {profile.inTrackedChannel ? 'In voice channel' : 'Not in voice channel'}
        </span>
      </div>
    </div>
  );
}
