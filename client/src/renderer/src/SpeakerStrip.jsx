export default function SpeakerStrip({ roster, speakingIds }) {
  return (
    <div className="speaker-strip">
      {roster.map((member) => (
        <img
          key={member.speakerId}
          src={member.avatarURL}
          alt={member.username}
          width={48}
          height={48}
          className={speakingIds.has(member.speakerId) ? 'speaker-icon speaker-icon--speaking' : 'speaker-icon'}
        />
      ))}
    </div>
  );
}
