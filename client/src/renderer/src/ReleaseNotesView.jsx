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

import { RELEASE_NOTES } from './releaseNotes';

// Appending a fixed time-of-day avoids `new Date('2026-07-19')` being parsed
// as UTC midnight, which can roll back a day in negative-UTC-offset zones.
function formatReleaseDate(isoDate) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ReleaseNotesView({ onBack }) {
  return (
    <div className="settings-view">
      <div className="settings-topbar">
        <div className="settings-topbar-inner">
          <button className="settings-back-btn" onClick={onBack}>
            ‹ Back
          </button>
          <h2 className="settings-title">Release Notes</h2>
        </div>
      </div>
      <div className="settings-scroll">
        <div className="release-notes-timeline">
          {RELEASE_NOTES.map((entry, index) => (
            <div className="release-notes-entry" key={entry.version}>
              <div className="release-notes-marker">
                <span
                  className={`release-notes-dot${index === 0 ? ' release-notes-dot--current' : ''}`}
                />
                {index < RELEASE_NOTES.length - 1 && <span className="release-notes-line" />}
              </div>
              <div className="release-notes-body">
                <h3 className="release-notes-version">v{entry.version}</h3>
                <p className="release-notes-date">{formatReleaseDate(entry.date)}</p>
                <ul className="release-notes-changes">
                  {entry.changes.map((change, changeIndex) => {
                    const { text, sub } = typeof change === 'string' ? { text: change, sub: null } : change;
                    return (
                      <li key={changeIndex}>
                        {text}
                        {sub && (
                          <ul className="release-notes-sub-changes">
                            {sub.map((subText, subIndex) => (
                              <li key={subIndex}>{subText}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
