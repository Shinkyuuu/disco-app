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

import './SpeakerStrip.css';
import { resolveAppearance } from './resolveAppearance';

const EMPTY_PROFILE = { avatarSilent: null, avatarSpeaking: null, usernameColor: null, chatColor: null };

function MicOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function HeadphonesOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
      <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export default function SpeakerStrip({ roster, speakingIds, avatarMode, avatarSize = 'small', profileBySpeaker = {} }) {
  return (
    <div className={`speaker-strip speaker-strip--${avatarSize}`}>
      {roster.map((member) => {
        const isSpeaking = speakingIds.has(member.speakerId);
        const isSilenced = member.isDeafened || member.isMuted;
        const { avatarSrc, usernameColor } = resolveAppearance({
          avatarMode,
          isSpeaking,
          discordAvatarURL: member.avatarURL,
          profile: profileBySpeaker[member.speakerId] ?? EMPTY_PROFILE,
          customAvatarSilentURL: member.customAvatarSilentURL,
          customAvatarSpeakingURL: member.customAvatarSpeakingURL,
          broadcastUsernameColor: member.usernameColor,
          broadcastChatColor: member.chatColor,
        });
        return (
          <div key={member.speakerId} className={`speaker speaker--${avatarSize}`}>
            <div className={`speaker-username${isSilenced ? ' speaker-username--silenced' : ''}`}>
              {member.username}
            </div>
            <img
              src={avatarSrc}
              alt={member.username}
              style={isSpeaking && usernameColor ? { '--glow-color': usernameColor } : undefined}
              className={[
                'speaker-icon',
                avatarMode === 'discord' ? 'speaker-icon--discord' : 'speaker-icon--custom',
                `speaker-icon--${avatarSize}`,
                isSpeaking ? 'speaker-icon--speaking' : '',
                isSilenced ? 'speaker-icon--silenced' : '',
              ].filter(Boolean).join(' ')}
            />
            {/* Deafened implies muted (Discord semantics) - show one icon, deafened first. */}
            {isSilenced && (
              <div className="speaker-status-icon" title={member.isDeafened ? 'Deafened' : 'Muted'}>
                {member.isDeafened ? <HeadphonesOffIcon /> : <MicOffIcon />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
