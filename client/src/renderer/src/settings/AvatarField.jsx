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

// Avatar picker used by both ProfileFieldsEditor (Your Profile / Friend
// cards / Default Slots) and PublicAvatarSection: thumbnail (or dashed "+"
// placeholder) with Change/Add and Clear buttons. `busy` dims the thumbnail
// and disables both buttons while an upload/clear request is in flight.
// `alignWithTabs` reserves the same vertical space SpeakingAvatarField's tab
// bar occupies above its own thumbnail (an invisible, identically-marked-up
// tab bar rather than a hardcoded pixel offset, so it stays correct even if
// the tab bar's own padding/font-size changes later) - used only for the
// Silent field, which sits beside a tabbed Speaking field with nothing of
// its own above the thumbnail.
export default function AvatarField({ label, src, onPick, onClear, busy = false, alignWithTabs = false }) {
  return (
    <div className="pf-field">
      {alignWithTabs && (
        <div className="pf-type-tabs pf-type-tabs--spacer" aria-hidden="true">
          <button type="button" className="pf-type-tab" tabIndex={-1}>
            Image
          </button>
        </div>
      )}
      <span className="pf-label">{label}</span>
      <div className="pf-avatar-wrap">
        {src ? (
          <img
            className={`pf-avatar ${busy ? 'pf-avatar--busy' : ''}`.trim()}
            src={src}
            alt={label}
          />
        ) : (
          <div
            className={`pf-avatar pf-avatar--empty ${busy ? 'pf-avatar--busy' : ''}`.trim()}
            aria-hidden="true"
          >
            {!busy && '+'}
          </div>
        )}
        {busy && <span className="pf-avatar-spinner" aria-hidden="true" />}
      </div>
      <div className="pf-actions">
        <button className="pf-btn" onClick={onPick} disabled={busy}>
          {src ? 'Change' : 'Add'}
        </button>
        {src && (
          <button className="pf-btn pf-btn--muted" onClick={onClear} disabled={busy}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
