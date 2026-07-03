import './SpeakerStrip.css';

export default function SpeakerStrip({ roster, speakingIds, avatarMode, customAvatarBySpeaker = {} }) {
  return (
    <div className="speaker-strip">
      {roster.map((member) => (
        <img
          key={member.speakerId}
          src={
            avatarMode === 'discord'
              ? member.avatarURL
              : customAvatarBySpeaker[member.speakerId] ?? member.avatarURL
          }
          alt={member.username}
          className={[
            'speaker-icon',
            avatarMode === 'discord' ? 'speaker-icon--discord' : 'speaker-icon--custom',
            speakingIds.has(member.speakerId) ? 'speaker-icon--speaking' : '',
          ].filter(Boolean).join(' ')}
        />
      ))}
    </div>
  );
}
