export default function MessageLog({ entries, interimBySpeaker }) {
  const interimEntries = Object.values(interimBySpeaker);
  return (
    <div className="message-log">
      {entries.map((entry, i) => (
        <div key={i} className="message-line">
          <img src={entry.avatarURL} alt="" width={24} height={24} />
          <strong>{entry.username}</strong>
          <span>{entry.text}</span>
        </div>
      ))}
      {interimEntries.map((entry) => (
        <div key={entry.speakerId} className="message-line message-line--interim">
          <img src={entry.avatarURL} alt="" width={24} height={24} />
          <strong>{entry.username}</strong>
          <span>{entry.text}</span>
        </div>
      ))}
    </div>
  );
}
