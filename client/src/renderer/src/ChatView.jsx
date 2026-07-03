import { useEffect, useState } from 'react';
import SpeakerStrip from './SpeakerStrip';
import MessageLog from './MessageLog';

export default function ChatView() {
  const [roster, setRoster] = useState([]);
  const [speakingIds, setSpeakingIds] = useState(new Set());
  const [entries, setEntries] = useState([]);
  const [interimBySpeaker, setInterimBySpeaker] = useState({});
  const [settings, setSettings] = useState(null);
  const [connectionState, setConnectionState] = useState({ status: 'connected' });

  useEffect(() => {
    window.api.getSettings().then(setSettings);
    window.api.onConnectionState(setConnectionState);
    window.api.onStateSnapshot((snapshot) => {
      setRoster(snapshot.roster);
      setEntries(snapshot.messageLog);
    });
    window.api.onRoster(setRoster);
    window.api.onSpeaking(({ speakerId, isSpeaking }) => {
      setSpeakingIds((prev) => {
        const next = new Set(prev);
        if (isSpeaking) next.add(speakerId);
        else next.delete(speakerId);
        return next;
      });
    });
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
    });
  }, []);

  if (connectionState.status === 'auth-failed' && connectionState.reason === 'not in voice channel') {
    return (
      <div>
        <p>You need to be in the voice channel being captioned.</p>
        <button onClick={() => window.api.startChatWindow()}>Retry</button>
      </div>
    );
  }
  if (connectionState.status === 'auth-failed') {
    return (
      <div>
        <p>Your session expired — please log in again.</p>
        <button
          disabled={!settings}
          onClick={() => settings && window.api.openLogin(settings.serverAddress)}
        >
          Log in
        </button>
      </div>
    );
  }
  if (connectionState.status === 'unreachable') {
    return (
      <div>
        <p>Can't reach {connectionState.serverAddress} — still retrying in the background.</p>
        <button onClick={() => window.api.focusLauncherSettings()}>Edit server address in Settings</button>
      </div>
    );
  }
  if (connectionState.status === 'reconnecting') {
    return <p>Reconnecting…</p>;
  }

  return (
    <div>
      <SpeakerStrip roster={roster} speakingIds={speakingIds} avatarMode={settings?.avatarMode ?? 'discord'} />
      <MessageLog entries={entries} interimBySpeaker={interimBySpeaker} />
    </div>
  );
}
