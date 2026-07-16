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

import { useEffect, useRef, useState } from 'react';

// A native color input fires onChange continuously while the user drags within
// the picker, not just once on commit - onSet triggers an IPC write plus a full
// settings reload (see SettingsView's reload()), so calling it on every tick
// would fire many of those per second. Local state keeps the swatch preview
// instant while debouncing which value actually gets committed upstream.
const COLOR_COMMIT_DEBOUNCE_MS = 200;

// Drawn as crossed lines (not a "+" glyph) so it sits pixel-centered in the
// swatch regardless of font metrics - see FriendOverridesSection.jsx's RemoveIcon.
function PlusIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <line x1="5" y1="0" x2="5" y2="10" stroke="currentColor" strokeWidth="1.6" />
      <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export default function ColorField({ label, value, onSet, onClear, exampleText, exampleClassName }) {
  const [localValue, setLocalValue] = useState(value);
  // Render-phase state adjustment (not an effect) for "local state should reset
  // when this prop changes" - see https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setLocalValue(value);
  }
  const timeoutRef = useRef(null);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  function handleChange(next) {
    setLocalValue(next);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => onSet(next), COLOR_COMMIT_DEBOUNCE_MS);
  }

  return (
    <div className="pf-color-row">
      <span className="pf-label pf-color-row-label">{label}</span>
      <label
        className={`pf-swatch ${localValue ? '' : 'pf-swatch--empty'}`.trim()}
        style={localValue ? { background: localValue } : undefined}
      >
        {!localValue && <PlusIcon />}
        <input
          className="pf-color-input"
          type="color"
          value={localValue ?? '#ffffff'}
          onChange={(e) => handleChange(e.target.value)}
        />
      </label>
      <span className={`${exampleClassName} pf-color-example`} style={localValue ? { color: localValue } : undefined}>
        {exampleText}
      </span>
      <div className="pf-actions">
        {localValue && (
          <button className="pf-btn pf-btn--muted" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
