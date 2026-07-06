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
