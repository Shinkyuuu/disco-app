import { useEffect, useState } from 'react';

export default function LauncherView() {
  const [settings, setSettings] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [loginError, setLoginError] = useState(null);

  useEffect(() => {
    window.api.getSettings().then(setSettings);
    window.api.onAuthToken(() => {
      window.api.getSettings().then(setSettings);
      setLoginError(null);
    });
    window.api.onAuthError((reason) => {
      setLoginError(
        reason === 'access_denied'
          ? 'Login was cancelled.'
          : 'Login failed — please try again.',
      );
    });
    window.api.onOpenSettings(() => setShowSettings(true));
  }, []);

  if (!settings) return null;

  function handleStartChatWindow() {
    if (!settings.hasSessionToken) {
      setLoginError(null);
      window.api.openLogin(settings.serverAddress).catch(() =>
        setLoginError('Could not reach the login page — check the server address in Settings and try again.'),
      );
      return;
    }
    window.api.startChatWindow();
  }

  return (
    <div>
      <h1>discord-echo</h1>
      {loginError && (
        <div role="alert">
          <p>{loginError}</p>
          <button onClick={handleStartChatWindow}>Retry</button>
        </div>
      )}
      <button onClick={() => setShowSettings((s) => !s)}>Settings</button>
      <button onClick={handleStartChatWindow}>Start Chat Window</button>
      {settings.hasSessionToken && (
        <button onClick={() => window.api.logout().then(() => window.api.getSettings().then(setSettings))}>
          Log out
        </button>
      )}
      {showSettings && (
        <div>
          <label>
            Server address
            <input
              value={settings.serverAddress}
              onChange={(e) => setSettings((s) => ({ ...s, serverAddress: e.target.value }))}
              onBlur={(e) => window.api.setSettings({ serverAddress: e.target.value })}
            />
          </label>
          <label>
            Avatar mode
            <select
              value={settings.avatarMode}
              onChange={(e) => {
                const avatarMode = e.target.value;
                setSettings((s) => ({ ...s, avatarMode }));
                window.api.setSettings({ avatarMode });
              }}
            >
              <option value="discord">Discord avatar</option>
              <option value="custom">Custom image</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
