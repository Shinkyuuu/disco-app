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

import { useEffect, useRef, useState } from 'react';
import SpeakerStrip from './SpeakerStrip';
import MessageLog, { MESSAGE_VISIBLE_MS, MESSAGE_FADE_MS } from './MessageLog';
import WindowMenu from './WindowMenu';
import ChatStatusBanner from './ChatStatusBanner';
import { resolveFontOption, resolveBorderOption, DEFAULT_FONT_ID, DEFAULT_BORDER_ID } from './chatAppearanceOptions';
import { mergeEntries } from './mergeEntries';
import { resolveProfileColors } from './resolveAppearance';

// Every non-connected status this component ever shows, all through the same
// inline banner (see ChatStatusBanner) - no native dialog, no full-panel
// takeover. reconnecting/unreachable can resolve on their own; auth-failed/
// session-ended can't (the chat window closes itself shortly after - see
// scheduleChatWindowClose in client/src/main/index.js), but all four use the
// identical visual treatment per product decision.
const STATUS_BANNER_MESSAGES = {
  reconnecting: () => 'Reconnecting…',
  unreachable: (state) => `Can't reach ${state.serverAddress} - still retrying in the background.`,
  'auth-failed': (state) => (state.code === 4001
    ? 'You need to be in the voice channel being captioned.'
    : 'Your session expired - please log in again.'),
  'session-ended': () => 'The bot left the voice channel - captioning has stopped.',
};

// Shared frame: invisible header strip (avatars float here, and it drags the
// frameless window) above the opaque chat panel with the window menu.
// headerOverlay is the connection-status banner (see ChatStatusBanner) -
// rendered inside the header itself so it can slide up in front of the
// avatars, visible even while the panel below is collapsed.
function ChatFrame({ header = null, headerOverlay = null, panelClass = '', avatarSize = 'small', avatarMode = 'discord', collapsed = false, locked = false, panelStyle, menuSections, children }) {
  return (
    <div className="chat-root">
      <div className={`chat-header chat-header--${avatarSize} ${avatarMode === 'discord' ? 'chat-header--discord' : ''}`.trim()}>
        {header}
        {headerOverlay}
      </div>
      <div className={`chat-panel ${panelClass} ${collapsed ? 'chat-panel--collapsed' : ''}`.trim()} style={panelStyle}>
        <WindowMenu sections={menuSections} locked={locked} />
        {!collapsed && children}
      </div>
    </div>
  );
}

export default function ChatView() {
  const [roster, setRoster] = useState([]);
  const [speakingIds, setSpeakingIds] = useState(new Set());
  const [entries, setEntries] = useState([]);
  const [settings, setSettings] = useState(null);
  const [connectionState, setConnectionState] = useState({ status: 'connected' });

  // speakerId -> resolved { avatarSilent, avatarSpeaking, usernameColor, chatColor }.
  // Resolved once per newly-seen speaker (cached), mirroring the old
  // avatarIndexBySpeaker ref. Friends don't consume a default slot, so the slot
  // counter only advances for non-friends - which requires knowing the friend
  // set before assigning slots (loaded once into friendIds).
  const [profileBySpeaker, setProfileBySpeaker] = useState({});

  // speakerId -> last-known { usernameColor, chatColor } broadcast by that
  // speaker via the roster. Accumulated the same way as profileBySpeaker
  // (never dropped when a member leaves the roster) so colorBySpeaker below
  // stays correct for messages from a speaker who has since left.
  const [broadcastColorBySpeaker, setBroadcastColorBySpeaker] = useState({});
  const [friendIds, setFriendIds] = useState(null); // null = not loaded yet
  const requestedRef = useRef(new Set());
  const slotCounterRef = useRef(0);

  useEffect(() => {
    window.api.getFriendProfiles().then((friends) => setFriendIds(new Set(Object.keys(friends))));
  }, []);

  // Resolve profiles for any roster members not yet requested - gated on the
  // friend set being loaded so slot assignment can skip friends correctly.
  useEffect(() => {
    if (!friendIds) return;
    for (const member of roster) {
      if (requestedRef.current.has(member.speakerId)) continue;
      requestedRef.current.add(member.speakerId);
      const slotIndex = friendIds.has(member.speakerId) ? -1 : slotCounterRef.current++;
      window.api.resolveSpeakerProfile({ speakerId: member.speakerId, slotIndex }).then((profile) => {
        setProfileBySpeaker((prev) => ({ ...prev, [member.speakerId]: profile }));
      });
    }
  }, [roster, friendIds]);

  useEffect(() => {
    setBroadcastColorBySpeaker((prev) => {
      const next = { ...prev };
      for (const member of roster) {
        next[member.speakerId] = { usernameColor: member.usernameColor ?? null, chatColor: member.chatColor ?? null };
      }
      return next;
    });
  }, [roster]);

  useEffect(() => {
    window.api.getSettings().then(setSettings);
    // Pull the snapshot after the live subscriptions below are registered, so
    // nothing falls between the snapshot and the event stream.
    const unsubscribes = [
      window.api.onConnectionState(setConnectionState),
      window.api.onRoster(setRoster),
      window.api.onSpeaking(({ speakerId, isSpeaking }) => {
        setSpeakingIds((prev) => {
          const next = new Set(prev);
          if (isSpeaking) next.add(speakerId);
          else next.delete(speakerId);
          return next;
        });
      }),
      window.api.onTranscript((event) => {
        setEntries((prev) => [...prev, event]);
      }),
      window.api.onSettingsChanged((partial) => {
        setSettings((prev) => (prev ? { ...prev, ...partial } : prev));
      }),
    ];
    window.api.getStateSnapshot().then((snapshot) => {
      setRoster(snapshot.roster);
      setEntries((prev) => mergeEntries(prev, snapshot.messageLog));
      setConnectionState(snapshot.connectionState);
    });
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, []);

  // Chats are fully visible for MESSAGE_VISIBLE_MS, then fade out over
  // MESSAGE_FADE_MS. receivedAt is stamped once in the main process (index.js)
  // so this stays correct across a close/reopen, not restarted from mount time.
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - (MESSAGE_VISIBLE_MS + MESSAGE_FADE_MS);
      setEntries((prev) => prev.filter((entry) => entry.receivedAt >= cutoff));
    }, 250);
    return () => clearInterval(interval);
  }, []);

  const avatarSize = settings?.avatarSize ?? 'small';
  const avatarMode = settings?.avatarMode ?? 'discord';
  // Threaded through even while showing a status banner: the chat window can
  // still be locked (and thus click-through at the OS level - see index.js)
  // while disconnected, and the ⋯ button is the only way to reach "Unlock
  // window" - without this, hovering it wouldn't carve out its click-through
  // exception and the button would become unreachable.
  const locked = settings?.chatLocked ?? false;

  // None of these ever replace the whole view - they slide up as a banner in
  // front of the avatars (see ChatFrame's headerOverlay), while roster/
  // captions keep rendering normally underneath for as long as the window
  // stays open.
  const bannerMessage = STATUS_BANNER_MESSAGES[connectionState.status]?.(connectionState);
  const statusBanner = bannerMessage ? { message: bannerMessage } : null;

  const chatSize = settings?.chatSize ?? 'medium';
  const chatOpacity = settings?.chatOpacity ?? 1;
  const chatCollapsed = settings?.chatCollapsed ?? false;
  const fontOption = resolveFontOption(settings?.chatFontFamily ?? DEFAULT_FONT_ID);
  const borderOption = resolveBorderOption(settings?.chatBorderStyle ?? DEFAULT_BORDER_ID);
  const colorBySpeaker = Object.fromEntries(
    Object.entries(profileBySpeaker).map(([id, profile]) => {
      const broadcast = broadcastColorBySpeaker[id] ?? {};
      return [id, resolveProfileColors({
        profile,
        broadcastUsernameColor: broadcast.usernameColor,
        broadcastChatColor: broadcast.chatColor,
      })];
    }),
  );

  return (
    <ChatFrame
      avatarSize={avatarSize}
      avatarMode={avatarMode}
      collapsed={chatCollapsed}
      locked={locked}
      menuSections={{ avatarSize: true, chatSize: true, opacity: true, pin: true, collapse: true, lock: true, autoWidth: true, snapToEdge: true }}
      panelStyle={{
        backgroundColor: `rgba(13, 14, 17, ${chatOpacity})`,
        '--chat-font-family': fontOption.cssFontFamily,
        '--chat-border-width': `${borderOption.borderWidth}px`,
        '--chat-border-radius': `${borderOption.borderRadius}px`,
      }}
      header={
        <SpeakerStrip
          roster={roster}
          speakingIds={speakingIds}
          avatarMode={avatarMode}
          avatarSize={avatarSize}
          profileBySpeaker={profileBySpeaker}
        />
      }
      headerOverlay={<ChatStatusBanner banner={statusBanner} />}
    >
      <MessageLog entries={entries} colorBySpeaker={colorBySpeaker} chatSize={chatSize} />
    </ChatFrame>
  );
}
