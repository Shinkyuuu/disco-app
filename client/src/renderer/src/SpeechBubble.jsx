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

import { useEffect, useState } from 'react';
import { initialTypewriterState, tick, TICK_MS } from './typewriter';

const MESSAGES = [
  'Maybe Cody wants to play games!',
  'Whatever you do, stream it for Cody!',
  'Cody is a really cool guy!',
  "Let's all be nice to Cody!",
  "Cody goes to the gym at around 10:30, so be sure to play with him before then!",
  
];

export default function SpeechBubble() {
  const [state, setState] = useState(() => initialTypewriterState(Math.floor(Math.random() * MESSAGES.length)));

  useEffect(() => {
    const interval = setInterval(() => setState((prev) => tick(prev, MESSAGES)), TICK_MS);
    return () => clearInterval(interval);
  }, []);

  const message = MESSAGES[state.messageIndex];

  return (
    <div className="profile-speech-bubble">
      {message.slice(0, state.displayedLength)}
      <span className="speech-bubble-caret">|</span>
    </div>
  );
}
