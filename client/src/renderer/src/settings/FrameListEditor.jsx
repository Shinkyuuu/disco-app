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

const MIN_FRAMES = 2;
const MAX_FRAMES = 30;
const DEFAULT_FPS = 6;

// Two views: "saved" shows the existing Frames avatar (a GIF - it plays
// itself, no cycling logic needed here) with Replace/Clear; "editing" is the
// drag-reorderable picker, shown by default when nothing is saved yet, or
// after clicking Replace. Raw source frames are never retained once saved
// (design spec Section 3.1) - Replace always starts an empty picker, not a
// pre-filled one.
export default function FrameListEditor({ frames, busy, onPickFrames, onSave, onClear }) {
  const [editing, setEditing] = useState(!frames);
  const [pendingFrames, setPendingFrames] = useState([]); // [{path, previewUrl}]
  const [fps, setFps] = useState(frames?.fps ?? DEFAULT_FPS);
  const [dragIndex, setDragIndex] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleAddFrames() {
    const picked = await onPickFrames();
    if (picked.length === 0) return;
    setPendingFrames((prev) => [...prev, ...picked].slice(0, MAX_FRAMES));
  }

  function removeFrame(index) {
    setPendingFrames((prev) => prev.filter((_, i) => i !== index));
  }

  function handleDrop(index) {
    if (dragIndex === null || dragIndex === index) return;
    setPendingFrames((prev) => {
      const next = prev.slice();
      const [moved] = next.splice(dragIndex, 1);
      next.splice(index, 0, moved);
      return next;
    });
    setDragIndex(null);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await onSave(pendingFrames.map((f) => f.path), fps);
      setPendingFrames([]);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const disabled = busy || saving;

  if (!editing && frames) {
    return (
      <div className="pf-field">
        <span className="pf-label">Speaking</span>
        <div className="pf-avatar-wrap">
          <img className={`pf-avatar ${disabled ? 'pf-avatar--busy' : ''}`.trim()} src={frames.url} alt="Speaking (Frames)" />
        </div>
        <p className="settings-subtext">
          {frames.fps} fps - {frames.frameCount} frames
        </p>
        <div className="pf-actions">
          <button className="pf-btn" onClick={() => setEditing(true)} disabled={disabled}>
            Replace
          </button>
          <button className="pf-btn pf-btn--muted" onClick={onClear} disabled={disabled}>
            Clear
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pf-field">
      <span className="pf-label">Speaking</span>
      <div className="pf-frame-list">
        {pendingFrames.map((frame, index) => (
          <div
            key={`${frame.path}-${index}`}
            className="pf-frame-item"
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(index)}
          >
            <img className="pf-frame-thumb" src={frame.previewUrl} alt={`Frame ${index + 1}`} />
            <button className="pf-frame-remove" onClick={() => removeFrame(index)} aria-label={`Remove frame ${index + 1}`}>
              &times;
            </button>
          </div>
        ))}
        {pendingFrames.length < MAX_FRAMES && (
          <button className="pf-frame-add" onClick={handleAddFrames} disabled={disabled} aria-label="Add frames">
            +
          </button>
        )}
      </div>
      <label className="pf-fps-field">
        FPS
        <input
          type="number"
          min={1}
          max={30}
          value={fps}
          onChange={(e) => setFps(Number(e.target.value))}
          disabled={disabled}
        />
      </label>
      <div className="pf-actions">
        <button className="pf-btn" onClick={handleSave} disabled={disabled || pendingFrames.length < MIN_FRAMES}>
          Save
        </button>
        {frames && (
          <button className="pf-btn pf-btn--muted" onClick={() => setEditing(false)} disabled={disabled}>
            Cancel
          </button>
        )}
      </div>
      {error && <p className="settings-subtext">{error}</p>}
    </div>
  );
}
