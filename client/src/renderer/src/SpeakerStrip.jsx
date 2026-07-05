import './SpeakerStrip.css';

export default function SpeakerStrip({
  roster,
  speakingIds,
  avatarMode,
  avatarSize = 'small',
  customAvatarBySpeaker = {},
}) {
  return (
    <div className={`speaker-strip speaker-strip--${avatarSize}`}>
      {roster.map((member) => (
        <div key={member.speakerId} className={`speaker speaker--${avatarSize}`}>
          <img
            src={
              avatarMode === 'discord'
                ? member.avatarURL
                : customAvatarBySpeaker[member.speakerId] ?? member.avatarURL
            }
            alt={member.username}
            className={[
              'speaker-icon',
              avatarMode === 'discord' ? 'speaker-icon--discord' : 'speaker-icon--custom',
              `speaker-icon--${avatarSize}`,
              speakingIds.has(member.speakerId) ? 'speaker-icon--speaking' : '',
            ].filter(Boolean).join(' ')}
          />
          {/* Deafened implies muted (Discord semantics) — show one badge, deafened first. */}
          {(member.isDeafened || member.isMuted) && (
            <span className="speaker-badge" title={member.isDeafened ? 'Deafened' : 'Muted'}>
              {member.isDeafened ? '🎧' : '🎤'}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
