import { useEffect, useState } from 'react';
import YourProfileSection from './YourProfileSection';
import DefaultSlotsSection from './DefaultSlotsSection';
import FriendOverridesSection from './FriendOverridesSection';
import ChatAppearanceSection from './ChatAppearanceSection';
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
            <select value={settings.avatarMode} onChange={(e) => onSettingsChange({ avatarMode: e.target.value }, true)}>
              <option value="discord">Discord avatar</option>
              <option value="custom">Custom image</option>
            </select>
          </label>
        </section>

        <ChatAppearanceSection settings={settings} onSettingsChange={onSettingsChange} />

        <YourProfileSection loggedInUserId={loggedInUserId} profile={yourProfile} onChange={reload} />
        <FriendOverridesSection friends={otherFriends} onChange={reload} />
        <DefaultSlotsSection profiles={defaultProfiles} onChange={reload} />
      </div>
    </div>
  );
}
