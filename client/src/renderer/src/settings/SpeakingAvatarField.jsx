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

import { useState } from 'react';
import AvatarField from './AvatarField';
import FrameListEditor from './FrameListEditor';

const TABS = [
  { type: 'image', label: 'Image' },
  { type: 'gif', label: 'GIF' },
  { type: 'frames', label: 'Frames' },
];

// The speaking-avatar field for all three profile surfaces (default slots,
// friend overrides, public/broadcast) - three independently-saved variants
// (Image/GIF/Frames) that all persist simultaneously; switching tabs never
// discards the other two (design spec Section 1). AvatarField itself is
// reused unmodified for the Image/GIF tabs - only Frames needs a different
// body (FrameListEditor), since it's a multi-file picker, not a single
// thumbnail.
export default function SpeakingAvatarField({
  variants,
  busy,
  onPickImage,
  onPickGif,
  onPickFrames,
  onSaveFrames,
  onSetActiveType,
  onClearImage,
  onClearGif,
  onClearFrames,
}) {
  const safeVariants = variants ?? { activeType: null, image: null, gif: null, frames: null };
  const hasContent = { image: Boolean(safeVariants.image), gif: Boolean(safeVariants.gif), frames: Boolean(safeVariants.frames) };
  const [viewType, setViewType] = useState(safeVariants.activeType ?? 'image');

  // Switches the visible tab optimistically, but reverts if the "make this
  // active" call fails - per the design spec's error-handling rule (Section
  // 5), a failed switch must not leave the UI silently pointing at a tab
  // that isn't actually active server/store-side. Requires onSetActiveType's
  // returned promise to reject on failure (see Tasks 3-4's call sites).
  async function selectTab(type) {
    const previous = viewType;
    setViewType(type);
    if (hasContent[type] && safeVariants.activeType !== type) {
      try {
        await onSetActiveType(type);
      } catch {
        setViewType(previous);
      }
    }
  }

  return (
    <div className="pf-speaking-field">
      <div className="pf-type-tabs" role="tablist">
        {TABS.map(({ type, label }) => (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={viewType === type}
            className={`pf-type-tab ${viewType === type ? 'pf-type-tab--active' : ''} ${hasContent[type] ? 'pf-type-tab--filled' : ''}`.trim()}
            onClick={() => selectTab(type)}
            disabled={busy}
          >
            {label}
          </button>
        ))}
      </div>
      {viewType === 'frames' ? (
        <FrameListEditor frames={safeVariants.frames} busy={busy} onPickFrames={onPickFrames} onSave={onSaveFrames} onClear={onClearFrames} />
      ) : (
        <AvatarField
          label="Speaking"
          src={viewType === 'image' ? safeVariants.image : safeVariants.gif}
          busy={busy}
          onPick={viewType === 'image' ? onPickImage : onPickGif}
          onClear={viewType === 'image' ? onClearImage : onClearGif}
        />
      )}
    </div>
  );
}
