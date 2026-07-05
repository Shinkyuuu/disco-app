import { useEffect, useRef, useState } from 'react';
import SpeakerStrip from './SpeakerStrip';
import MessageLog, { MESSAGE_VISIBLE_MS, MESSAGE_FADE_MS } from './MessageLog';
import WindowMenu from './WindowMenu';
import { customAvatars } from './customAvatars';

// The one-time state-snapshot pull and the live transcript push are two
// independent async writers of `entries` with no ordering guarantee between
// them — merging (keyed by speakerId+receivedAt, deduped, time-sorted) makes
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
// avatarSize/onAvatarSizeChange are only passed by the main render (where
// avatars actually show) — the header height class still needs a size to
// stay in sync with the window's own height (see main/index.js), so it
// defaults to 'small' regardless.
function ChatFrame({ header = null, panelClass = '', avatarSize = 'small', onAvatarSizeChange, children }) {
  return (
    <div className="chat-root">
      <div className={`chat-header chat-header--${avatarSize}`}>{header}</div>
      <div className={`chat-panel ${panelClass}`.trim()}>
        <WindowMenu avatarSize={onAvatarSizeChange ? avatarSize : undefined} onAvatarSizeChange={onAvatarSizeChange} />
        {children}
      </div>
    </div>
  );
}

export default function ChatView() {
  const [roster, setRoster] = useState([]);
  const [speakingIds, setSpeakingIds] = useState(new Set());
  const [entries, setEntries] = useState([]);
  const [interimBySpeaker, setInterimBySpeaker] = useState({});
  const [settings, setSettings] = useState(null);
  const [connectionState, setConnectionState] = useState({ status: 'connected' });

  // speakerId -> index into customAvatars, assigned in order of first appearance
  // in the roster ("first N users that join get the N images"). Stable for the
  // chat session; users beyond the image count fall back to their Discord avatar.
  const avatarIndexBySpeaker = useRef(new Map());
  function assignCustomAvatars(members) {
    const assigned = avatarIndexBySpeaker.current;
    for (const member of members) {
      if (!assigned.has(member.speakerId) && assigned.size < customAvatars.length) {
        assigned.set(member.speakerId, assigned.size);
      }
    }
  }

  function handleAvatarSizeChange(avatarSize) {
    // Optimistic — the main process resizes the window in lockstep with this
    // same call, so waiting for a round trip would visibly lag the resize.
    setSettings((prev) => (prev ? { ...prev, avatarSize } : prev));
    window.api.setSettings({ avatarSize });
  }

  useEffect(() => {
    window.api.getSettings().then(setSettings);
    // Pull the snapshot after the live subscriptions below are registered, so
    // nothing falls between the snapshot and the event stream.
    const unsubscribes = [
      window.api.onConnectionState(setConnectionState),
      window.api.onRoster((members) => {
        assignCustomAvatars(members);
        setRoster(members);
      }),
      window.api.onSpeaking(({ speakerId, isSpeaking }) => {
        setSpeakingIds((prev) => {
          const next = new Set(prev);
          if (isSpeaking) next.add(speakerId);
          else next.delete(speakerId);
          return next;
        });
      }),
      window.api.onTranscript((event) => {
        if (event.isFinal) {
          setEntries((prev) => [...prev, event]);
          setInterimBySpeaker((prev) => {
            const next = { ...prev };
            delete next[event.speakerId];
            return next;
          });
        } else {
          setInterimBySpeaker((prev) => ({ ...prev, [event.speakerId]: event }));
        }
      }),
    ];
    window.api.getStateSnapshot().then((snapshot) => {
      assignCustomAvatars(snapshot.roster);
      setRoster(snapshot.roster);
      setEntries((prev) => mergeEntries(prev, snapshot.messageLog));
      setConnectionState(snapshot.connectionState);
    });
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, []);

  // Chats are fully visible for 5 seconds, then fade out over MESSAGE_FADE_MS
  // (MessageLine computes the fade class from elapsed time on every render;
  // this interval's only job is to force that periodic re-render, and to
  // actually drop entries once the fade has finished). receivedAt is stamped
  // once in the main process (index.js) so this stays correct across a
  // close/reopen, not restarted from mount time.
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
        <p>Your session expired — please log in again.</p>
        <button
          disabled={!settings}
          onClick={() => settings && window.api.openLogin(settings.serverAddress)}
        >
          Log in
        </button>
      </ChatFrame>
    );
  }
  if (connectionState.status === 'unreachable') {
    return (
      <ChatFrame panelClass="chat-panel--message">
        <p>Can't reach {connectionState.serverAddress} — still retrying in the background.</p>
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

  return (
    <ChatFrame
      avatarSize={avatarSize}
      onAvatarSizeChange={handleAvatarSizeChange}
      header={
        <SpeakerStrip
          roster={roster}
          speakingIds={speakingIds}
          avatarMode={settings?.avatarMode ?? 'discord'}
          avatarSize={avatarSize}
          customAvatarBySpeaker={Object.fromEntries(
            [...avatarIndexBySpeaker.current].map(([speakerId, i]) => [speakerId, customAvatars[i]]),
          )}
        />
      }
    >
      <MessageLog entries={entries} interimBySpeaker={interimBySpeaker} />
    </ChatFrame>
  );
}
