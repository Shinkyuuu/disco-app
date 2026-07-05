import { useEffect, useState } from 'react';
import YourProfileSection from './YourProfileSection';
import DefaultSlotsSection from './DefaultSlotsSection';
import FriendOverridesSection from './FriendOverridesSection';

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

  return (
    <div className="settings-view">
      <div className="settings-topbar">
        <button onClick={onBack}>← Back</button>
      </div>
      <div className="settings-scroll">
        <section className="settings-section">
          <h3 className="settings-heading">Connection</h3>
          <label className="settings-field">
            Server address
            <input
              value={settings.serverAddress}
              onChange={(e) => onSettingsChange({ serverAddress: e.target.value }, false)}
              onBlur={(e) => window.api.setSettings({ serverAddress: e.target.value })}
            />
          </label>
          <label className="settings-field">
            Avatar mode
            <select value={settings.avatarMode} onChange={(e) => onSettingsChange({ avatarMode: e.target.value }, true)}>
              <option value="discord">Discord avatar</option>
              <option value="custom">Custom image</option>
            </select>
          </label>
        </section>

        <YourProfileSection loggedInUserId={loggedInUserId} profile={yourProfile} onChange={reload} />
        <DefaultSlotsSection profiles={defaultProfiles} onChange={reload} />
        <FriendOverridesSection friends={otherFriends} onChange={reload} />
      </div>
    </div>
  );
}
