import { useEffect, useState } from 'react';
import TitleBar from './TitleBar';
import SettingsView from './settings/SettingsView';
import ProfileHeader from './ProfileHeader';

export default function LauncherView() {
  const [settings, setSettings] = useState(null);
  const [page, setPage] = useState('main');
  const [loginError, setLoginError] = useState(null);
  const [profileState, setProfileState] = useState({ reachable: true, profile: null });

  useEffect(() => {
    window.api.getSettings().then(setSettings);
    window.api.getProfile().then((result) => {
      if (result) setProfileState(result);
    });
    const unsubscribes = [
      window.api.onAuthToken(() => {
        window.api.getSettings().then(setSettings);
        setLoginError(null);
      }),
      window.api.onAuthError((reason) => {
        if (reason === 'session_expired') {
          setLoginError(null);
          window.api.getSettings().then(setSettings);
          return;
        }
        setLoginError(reason === 'access_denied' ? 'Login was cancelled.' : 'Login failed — please try again.');
      }),
      window.api.onOpenSettings(() => setPage('settings')),
      window.api.onProfile((result) => setProfileState(result)),
    ];
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, []);

  if (!settings) return null;

  function handleLogin() {
    setLoginError(null);
    window.api.openLogin(settings.serverAddress).catch(() =>
      setLoginError('Could not reach the login page — check the server address in Settings and try again.'),
    );
  }

  // Optimistic local settings update; `persist` also writes through to the store.
  function handleSettingsChange(partial, persist) {
    setSettings((s) => ({ ...s, ...partial }));
    if (persist) window.api.setSettings(partial);
  }

  return (
    <div className="launcher-root">
      <TitleBar title="discord-echo" />
      {page === 'settings' ? (
        <SettingsView settings={settings} onSettingsChange={handleSettingsChange} onBack={() => setPage('main')} />
      ) : (
        <div className="launcher-content">
          {loginError && (
            <div role="alert">
              <p>{loginError}</p>
              <button onClick={handleLogin}>Retry</button>
            </div>
          )}
          {settings.hasSessionToken ? (
            <>
              <ProfileHeader profile={profileState.profile} reachable={profileState.reachable} />
              <button onClick={() => setPage('settings')}>Settings</button>
              <button onClick={() => window.api.startChatWindow()}>Start Chat Window</button>
              <button onClick={() => window.api.logout().then(() => window.api.getSettings().then(setSettings))}>
                Log out
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setPage('settings')}>Settings</button>
              <button onClick={handleLogin}>Login to Discord</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
