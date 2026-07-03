// A message is fully visible for MESSAGE_VISIBLE_MS, then fades out over
// MESSAGE_FADE_MS (CSS transition in app.css) before actually being removed.
// Exported so ChatView's removal timer (MESSAGE_VISIBLE_MS + MESSAGE_FADE_MS)
// can't drift out of sync with the fade this component renders.
export const MESSAGE_VISIBLE_MS = 5000;
export const MESSAGE_FADE_MS = 500;

function MessageLine({ entry, interim = false }) {
  const isFading = !interim && Date.now() - entry.receivedAt >= MESSAGE_VISIBLE_MS;
  return (
    <div
      className={[
        'message-line',
        interim ? 'message-line--interim' : '',
        isFading ? 'message-line--fading' : '',
      ].filter(Boolean).join(' ')}
    >
      <img src={entry.avatarURL} alt="" className="message-line-avatar" />
      <div className="message-line-body">
        <div className="message-line-username">{entry.username}</div>
        <div className="message-line-text">{entry.text}</div>
      </div>
    </div>
  );
}

export default function MessageLog({ entries, interimBySpeaker }) {
  const interimEntries = Object.values(interimBySpeaker);
  return (
    <div className="message-log">
      {entries.map((entry) => (
        <MessageLine key={`${entry.speakerId}-${entry.receivedAt}`} entry={entry} />
      ))}
      {interimEntries.map((entry) => (
        <MessageLine key={entry.speakerId} entry={entry} interim />
      ))}
    </div>
  );
}
