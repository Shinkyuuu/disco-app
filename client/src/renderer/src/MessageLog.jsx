/*
 * Copyright 2026 Cody Park
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useEffect, useRef } from 'react';

// A message is fully visible for MESSAGE_VISIBLE_MS, then fades out over
// MESSAGE_FADE_MS (CSS transition in app.css) before actually being removed.
// Exported so ChatView's removal timer (MESSAGE_VISIBLE_MS + MESSAGE_FADE_MS)
// can't drift out of sync with the fade this component renders.
export const MESSAGE_VISIBLE_MS = 10000;
export const MESSAGE_FADE_MS = 500;

function MessageLine({ entry, colors = {}, chatSize = 'medium' }) {
  const isFading = Date.now() - entry.receivedAt >= MESSAGE_VISIBLE_MS;
  return (
    <div
      className={[
        'message-line',
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

export default function MessageLog({ entries, colorBySpeaker = {}, chatSize = 'medium' }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

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
      <div ref={bottomRef} />
    </div>
  );
}
