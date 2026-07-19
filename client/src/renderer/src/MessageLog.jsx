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
import { isNearBottom } from './isNearBottom';

// How close to the bottom (in px) the user has to be for a new transcript to
// auto-scroll them the rest of the way. Anything further and they're treated
// as intentionally reading scrollback, so new messages append without moving
// their view.
const STICK_TO_BOTTOM_THRESHOLD_PX = 30;

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
  const containerRef = useRef(null);
  const bottomRef = useRef(null);
  const stickToBottomRef = useRef(true);

  const handleScroll = () => {
    stickToBottomRef.current = isNearBottom(containerRef.current, STICK_TO_BOTTOM_THRESHOLD_PX);
  };

  // Instant, not { behavior: 'smooth' }: an animated scroll fires 'scroll'
  // events mid-glide, which handleScroll reads as the user scrolling away
  // from the bottom - on a fast-arriving entry it latches
  // stickToBottomRef.current to false and auto-scroll never recovers.
  useEffect(() => {
    if (stickToBottomRef.current) {
      bottomRef.current?.scrollIntoView();
    }
  }, [entries]);

  return (
    <div className="message-log" ref={containerRef} onScroll={handleScroll}>
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
