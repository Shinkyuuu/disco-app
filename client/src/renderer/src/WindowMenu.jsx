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

import { useRef } from 'react';

// Frameless windows have no OS chrome, so each window draws this ⋯ button in
// its top-right corner. Clicking it opens the dropdown's actual content in a
// separate, always-on-top popup window (see ChatMenuView) rather than
// rendering it here - Electron clips all content to a window's own rect, so
// a dropdown needing more room than a (possibly collapsed, thin-bar-sized)
// chat window currently has would otherwise force resizing/moving the chat
// window itself just to show it. `sections` mirrors which optional items the
// popup should include (only the chat window's normal, non-error render
// passes any - error screens pass none, leaving just Exit).
//
// While the chat window is locked it's click-through (see index.js's
// chatLocked handling), so this button is the only way back to "Unlock
// window" - hovering it carves out a clickable exception via
// setIgnoreMouseEvents, un-ignoring on enter and re-ignoring on leave.
export default function WindowMenu({ sections = {}, locked = false }) {
  const buttonRef = useRef(null);

  function handleClick() {
    const rect = buttonRef.current.getBoundingClientRect();
    const anchor = {
      x: Math.round(window.screenX + rect.left),
      y: Math.round(window.screenY + rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    window.api.openChatMenu(anchor, sections);
  }

  return (
    <div className="window-menu">
      <button
        ref={buttonRef}
        aria-label="Window menu"
        onClick={handleClick}
        onMouseEnter={() => locked && window.api.setIgnoreMouseEvents(false)}
        onMouseLeave={() => locked && window.api.setIgnoreMouseEvents(true)}
      >
        ⋯
      </button>
    </div>
  );
}
