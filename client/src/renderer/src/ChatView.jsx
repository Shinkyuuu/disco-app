import { useEffect, useRef, useState } from 'react';
import SpeakerStrip from './SpeakerStrip';
import MessageLog from './MessageLog';
import WindowMenu from './WindowMenu';
import { customAvatars } from './customAvatars';

// Shared frame: invisible header strip (avatars float here, and it drags the
// frameless window) above the opaque chat panel with the window menu.
function ChatFrame({ header = null, panelClass = '', children }) {
  return (
    <div className="chat-root">
      <div className="chat-header">{header}</div>
      <div className={`chat-panel ${panelClass}`.trim()}>
        <WindowMenu />
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
      setEntries(snapshot.messageLog);
      setConnectionState(snapshot.connectionState);
    });
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
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

  return (
    <ChatFrame
      header={
        <SpeakerStrip
          roster={roster}
          speakingIds={speakingIds}
          avatarMode={settings?.avatarMode ?? 'discord'}
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
