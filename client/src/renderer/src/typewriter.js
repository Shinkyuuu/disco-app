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

// Drives the profile speech bubble: type a message out one character at a
// time, hold it fully visible, delete it one character at a time, then move
// to the next message and repeat. `tick` is a pure step function so the
// timing math can be unit-tested without a real timer or React.
export const TICK_MS = 20;
const TYPE_MS = 35;
const DELETE_MS = 20;
const HOLD_MS = 30000;

export function initialTypewriterState(messageIndex = 0) {
  return { phase: 'typing', messageIndex, displayedLength: 0, elapsedInPhaseMs: 0 };
}

export function tick(state, messages) {
  const message = messages[state.messageIndex];
  const elapsed = state.elapsedInPhaseMs + TICK_MS;

  if (state.phase === 'typing') {
    const displayedLength = Math.floor(elapsed / TYPE_MS);
    if (displayedLength >= message.length) {
      return { phase: 'holding', messageIndex: state.messageIndex, displayedLength: message.length, elapsedInPhaseMs: 0 };
    }
    return { ...state, displayedLength, elapsedInPhaseMs: elapsed };
  }

  if (state.phase === 'holding') {
    if (elapsed >= HOLD_MS) {
      return { phase: 'deleting', messageIndex: state.messageIndex, displayedLength: message.length, elapsedInPhaseMs: 0 };
    }
    return { ...state, elapsedInPhaseMs: elapsed };
  }

  // deleting
  const displayedLength = message.length - Math.floor(elapsed / DELETE_MS);
  if (displayedLength <= 0) {
    const nextIndex = (state.messageIndex + 1) % messages.length;
    return { phase: 'typing', messageIndex: nextIndex, displayedLength: 0, elapsedInPhaseMs: 0 };
  }
  return { ...state, displayedLength, elapsedInPhaseMs: elapsed };
}
