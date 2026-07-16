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
import DefaultSlotsSection from './DefaultSlotsSection';
import FriendOverridesSection from './FriendOverridesSection';
import PublicAvatarSection from './PublicAvatarSection';
import ChatAppearanceSection from './ChatAppearanceSection';
import ToggleSwitch from './ToggleSwitch';
import Select from './Select';
import { resolveFontOption, DEFAULT_FONT_ID } from '../chatAppearanceOptions';

export default function SettingsView({ settings, onSettingsChange, onBack }) {
  const [defaultProfiles, setDefaultProfiles] = useState([]);
  const [friendProfiles, setFriendProfiles] = useState({});

  function reload() {
    window.api.getDefaultProfiles().then(setDefaultProfiles);
    window.api.getFriendProfiles().then(setFriendProfiles);
  }

  useEffect(() => {
    reload();
  }, []);

  const loggedInUserId = settings.loggedInUserId;
  const yourProfile = loggedInUserId ? friendProfiles[loggedInUserId] : null;
  const otherFriends = Object.fromEntries(
    Object.entries(friendProfiles).filter(([id]) => id !== loggedInUserId),
  );
  const fontOption = resolveFontOption(settings.chatFontFamily ?? DEFAULT_FONT_ID);

  return (
    <div className="settings-view">
      <div className="settings-topbar">
        <div className="settings-topbar-inner">
          <button className="settings-back-btn" onClick={onBack}>
            ‹ Back
          </button>
          <h2 className="settings-title">Settings</h2>
        </div>
      </div>
      <div className="settings-scroll" style={{ '--chat-font-family': fontOption.cssFontFamily }}>
        <h3 className="settings-heading">General</h3>
        <section className="settings-section">
          <label className="settings-field">
            Avatar mode
            <Select
              value={settings.avatarMode}
              onChange={(value) => onSettingsChange({ avatarMode: value }, true)}
              options={[
                { value: 'discord', label: 'Discord avatar' },
                { value: 'custom', label: 'Custom image' },
              ]}
            />
          </label>
        </section>

        <ChatAppearanceSection settings={settings} onSettingsChange={onSettingsChange} />

        <PublicAvatarSection loggedInUserId={loggedInUserId} profile={yourProfile} onChange={reload} />
        <FriendOverridesSection friends={otherFriends} onChange={reload} />
        <DefaultSlotsSection profiles={defaultProfiles} onChange={reload} />

        <h3 className="settings-heading">Developer Options</h3>
        <section className="settings-section">
          <div className="settings-toggle-row">
            <span className="settings-toggle-row-label">Receive beta updates</span>
            <ToggleSwitch
              checked={settings.betaUpdates ?? false}
              onChange={(checked) => onSettingsChange({ betaUpdates: checked }, true)}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
