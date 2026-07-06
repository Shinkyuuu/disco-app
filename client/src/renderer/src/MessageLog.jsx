import { useEffect, useRef } from 'react';

// A message is fully visible for MESSAGE_VISIBLE_MS, then fades out over
// MESSAGE_FADE_MS (CSS transition in app.css) before actually being removed.
// Exported so ChatView's removal timer (MESSAGE_VISIBLE_MS + MESSAGE_FADE_MS)
// can't drift out of sync with the fade this component renders.
export const MESSAGE_VISIBLE_MS = 10000;
export const MESSAGE_FADE_MS = 500;

function MessageLine({ entry, interim = false, colors = {}, chatSize = 'medium' }) {
  const isFading = !interim && Date.now() - entry.receivedAt >= MESSAGE_VISIBLE_MS;
  return (
    <div
      className={[
        'message-line',
        interim ? 'message-line--interim' : '',
        isFading ? 'message-line--fading' : '',
      ].filter(Boolean).join(' ')}
    >
      <img src={entry.avatarURL} alt="" className={`message-line-avatar message-line-avatar--${chatSize}`} />
      <div className="message-line-body">
        <div
          className={`message-line-username message-line-username--${chatSize}`}
          style={colors.usernameColor ? { color: colors.usernameColor } : undefined}
        >
          {entry.username}
        </div>
        <div
          className={`message-line-text message-line-text--${chatSize}`}
          style={colors.chatColor ? { color: colors.chatColor } : undefined}
        >
          {entry.text}
        </div>
      </div>
    </div>
  );
}

export default function MessageLog({ entries, interimBySpeaker, colorBySpeaker = {}, chatSize = 'medium' }) {
  const interimEntries = Object.values(interimBySpeaker);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries, interimBySpeaker]);

  return (
    <div className="message-log">
      {entries.map((entry) => (
        <MessageLine
          key={`${entry.speakerId}-${entry.receivedAt}`}
          entry={entry}
          colors={colorBySpeaker[entry.speakerId]}
          chatSize={chatSize}
        />
      ))}
      {interimEntries.map((entry) => (
        <MessageLine key={entry.speakerId} entry={entry} interim colors={colorBySpeaker[entry.speakerId]} chatSize={chatSize} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
