import { useEffect, useState } from 'react';
import SpeakerStrip from './SpeakerStrip';
import MessageLog from './MessageLog';

export default function ChatView() {
  const [roster, setRoster] = useState([]);
  const [speakingIds, setSpeakingIds] = useState(new Set());
  const [entries, setEntries] = useState([]);
  const [interimBySpeaker, setInterimBySpeaker] = useState({});

  useEffect(() => {
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

  return (
    <div>
      <SpeakerStrip roster={roster} speakingIds={speakingIds} />
      <MessageLog entries={entries} interimBySpeaker={interimBySpeaker} />
    </div>
  );
}
