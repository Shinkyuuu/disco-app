import { useEffect, useRef, useState } from 'react';
import SpeakerStrip from './SpeakerStrip';
import MessageLog, { MESSAGE_VISIBLE_MS, MESSAGE_FADE_MS } from './MessageLog';
import WindowMenu from './WindowMenu';
import { resolveFontOption, resolveBorderOption, DEFAULT_FONT_ID, DEFAULT_BORDER_ID } from './chatAppearanceOptions';

// The one-time state-snapshot pull and the live transcript push are two
// independent async writers of `entries` with no ordering guarantee between
// them - merging (keyed by speakerId+receivedAt, deduped, time-sorted) makes
// the result immune to which one resolves last. An unconditional overwrite
// here previously let a late-resolving snapshot erase an already-appended
// live message, which looked like the message vanishing immediately.
function mergeEntries(current, incoming) {
  const merged = new Map();
  for (const entry of current) merged.set(`${entry.speakerId}-${entry.receivedAt}`, entry);
  for (const entry of incoming) merged.set(`${entry.speakerId}-${entry.receivedAt}`, entry);
  return [...merged.values()].sort((a, b) => a.receivedAt - b.receivedAt);
}

// Shared frame: invisible header strip (avatars float here, and it drags the
// frameless window) above the opaque chat panel with the window menu.
function ChatFrame({
  header = null,
  panelClass = '',
  avatarSize = 'small',
  onAvatarSizeChange,
  chatSize,
  onChatSizeChange,
  pinned,
  onPinToggle,
  collapsed = false,
  onCollapsedToggle,
  panelStyle,
  opacity,
  onOpacityChange,
  children,
}) {
  return (
    <div className="chat-root">
      <div className={`chat-header chat-header--${avatarSize}`}>{header}</div>
      <div className={`chat-panel ${panelClass} ${collapsed ? 'chat-panel--collapsed' : ''}`.trim()} style={panelStyle}>
        <WindowMenu
          avatarSize={onAvatarSizeChange ? avatarSize : undefined}
          onAvatarSizeChange={onAvatarSizeChange}
          chatSize={onChatSizeChange ? chatSize : undefined}
          onChatSizeChange={onChatSizeChange}
          pinned={pinned}
          onPinToggle={onPinToggle}
          collapsed={collapsed}
          onCollapsedToggle={onCollapsedToggle}
          opacity={opacity}
          onOpacityChange={onOpacityChange}
        />
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
  const [friendIds, setFriendIds] = useState(null); // null = not loaded yet
  const [pinned, setPinned] = useState(true);
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

  function handleAvatarSizeChange(avatarSize) {
    // Optimistic - the main process resizes the window in lockstep with this
    // same call, so waiting for a round trip would visibly lag the resize.
    setSettings((prev) => (prev ? { ...prev, avatarSize } : prev));
    window.api.setSettings({ avatarSize });
  }

  function handleChatSizeChange(chatSize) {
    setSettings((prev) => (prev ? { ...prev, chatSize } : prev));
    window.api.setSettings({ chatSize });
  }

  function handleOpacityChange(chatOpacity) {
    setSettings((prev) => (prev ? { ...prev, chatOpacity } : prev));
    window.api.setSettings({ chatOpacity });
  }

  function handleCollapsedToggle(chatCollapsed) {
    setSettings((prev) => (prev ? { ...prev, chatCollapsed } : prev));
    window.api.setSettings({ chatCollapsed });
  }

  useEffect(() => {
    window.api.isAlwaysOnTop().then(setPinned);
  }, []);

  function handlePinToggle(value) {
    setPinned(value);
    window.api.setAlwaysOnTop(value);
  }

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

  if (connectionState.status === 'auth-failed' && connectionState.reason === 'not in voice channel') {
    return (
      <ChatFrame panelClass="chat-panel--message">
        <p>You need to be in the voice channel being captioned.</p>
        <button onClick={() => window.api.startChatWindow()}>Retry</button>
      </ChatFrame>
    );
  }
  if (connectionState.status === 'auth-failed') {
    return (
      <ChatFrame panelClass="chat-panel--message">
        <p>Your session expired - please log in again.</p>
        <button disabled={!settings} onClick={() => settings && window.api.openLogin(settings.serverAddress)}>
          Log in
        </button>
      </ChatFrame>
    );
  }
  if (connectionState.status === 'unreachable') {
    return (
      <ChatFrame panelClass="chat-panel--message">
        <p>Can't reach {connectionState.serverAddress} - still retrying in the background.</p>
        <button onClick={() => window.api.focusLauncherSettings()}>Edit server address in Settings</button>
      </ChatFrame>
    );
  }
  if (connectionState.status === 'reconnecting') {
    return (
      <ChatFrame panelClass="chat-panel--message">
        <p>Reconnecting…</p>
      </ChatFrame>
    );
  }

  const avatarSize = settings?.avatarSize ?? 'small';
  const avatarMode = settings?.avatarMode ?? 'discord';
  const chatSize = settings?.chatSize ?? 'medium';
  const chatOpacity = settings?.chatOpacity ?? 1;
  const chatCollapsed = settings?.chatCollapsed ?? false;
  const fontOption = resolveFontOption(settings?.chatFontFamily ?? DEFAULT_FONT_ID);
  const borderOption = resolveBorderOption(settings?.chatBorderStyle ?? DEFAULT_BORDER_ID);
  const colorBySpeaker = Object.fromEntries(
    Object.entries(profileBySpeaker).map(([id, p]) => [id, { usernameColor: p.usernameColor, chatColor: p.chatColor }]),
  );

  return (
    <ChatFrame
      avatarSize={avatarSize}
      onAvatarSizeChange={handleAvatarSizeChange}
      chatSize={chatSize}
      onChatSizeChange={handleChatSizeChange}
      pinned={pinned}
      onPinToggle={handlePinToggle}
      collapsed={chatCollapsed}
      onCollapsedToggle={handleCollapsedToggle}
      panelStyle={{
        backgroundColor: `rgba(13, 14, 17, ${chatOpacity})`,
        '--chat-font-family': fontOption.cssFontFamily,
        '--chat-border-width': `${borderOption.borderWidth}px`,
        '--chat-border-radius': `${borderOption.borderRadius}px`,
      }}
      opacity={chatOpacity}
      onOpacityChange={handleOpacityChange}
      header={
        <SpeakerStrip
          roster={roster}
          speakingIds={speakingIds}
          avatarMode={avatarMode}
          avatarSize={avatarSize}
          profileBySpeaker={profileBySpeaker}
        />
      }
    >
      <MessageLog entries={entries} colorBySpeaker={colorBySpeaker} chatSize={chatSize} />
    </ChatFrame>
  );
}
