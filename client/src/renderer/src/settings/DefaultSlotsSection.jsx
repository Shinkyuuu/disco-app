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

import ProfileFieldsEditor from './ProfileFieldsEditor';
import { colorsOf } from './profileColors';

export default function DefaultSlotsSection({ profiles, onChange }) {
  async function update(mutate) {
    await mutate();
    onChange();
  }
  return (
    <details className="settings-collapsible">
      <summary className="settings-heading">Default Slots (10)</summary>
      <section className="settings-section">
        <p className="settings-subtext">Assigned by join order to speakers without a friend profile.</p>
        <div className="slot-rows">
          {profiles.map((profile, slotIndex) => (
            <div key={slotIndex} className="slot-row">
              <span className="slot-number">{slotIndex + 1}</span>
              <ProfileFieldsEditor
                layout="row"
                profile={profile}
                onPickAvatar={(kind) => update(() => window.api.pickDefaultAvatarImage(slotIndex, kind))}
                onClearAvatar={(kind) => update(() => window.api.clearDefaultAvatarImage(slotIndex, kind))}
                onSetColor={(field, value) =>
                  update(() => window.api.setDefaultProfileColors(slotIndex, { ...colorsOf(profile), [field]: value }))
                }
                onClearColor={(field) =>
                  update(() => window.api.setDefaultProfileColors(slotIndex, { ...colorsOf(profile), [field]: null }))
                }
              />
            </div>
          ))}
        </div>
      </section>
    </details>
  );
}
