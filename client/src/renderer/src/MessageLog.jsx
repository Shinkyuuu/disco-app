function MessageLine({ entry, interim = false }) {
  return (
    <div className={interim ? 'message-line message-line--interim' : 'message-line'}>
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
