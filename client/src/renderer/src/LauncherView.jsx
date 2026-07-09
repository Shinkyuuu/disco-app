import { useEffect, useState } from 'react';
import TitleBar from './TitleBar';
import SettingsView from './settings/SettingsView';
import AboutView from './AboutView';
import ProfileHeader from './ProfileHeader';
import BorderGlow from './BorderGlow';
import Aurora from './Aurora';
import backgroundImage from './assets/background.png';

const AURORA_COLOR_STOPS = ['#3b82f6', '#7C3AED', '#3b82f6'];

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 3h12v8H6l-3 3v-3H2z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M7 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.5 5.5 14 8l-3.5 2.5M14 8H6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LoginIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M9 2h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.5 5.5 2 8l3.5 2.5M2 8h8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function LauncherView() {
  const [settings, setSettings] = useState(null);
  const [page, setPage] = useState('main');
  const [loginError, setLoginError] = useState(null);
  const [profileState, setProfileState] = useState({ reachable: true, profile: null });
  const [ownAppearance, setOwnAppearance] = useState(null);

  function reloadOwnAppearance(userId) {
    if (!userId) return;
    window.api.resolveSpeakerProfile({ speakerId: userId, slotIndex: -1 }).then(setOwnAppearance);
  }

  useEffect(() => {
    window.api.getSettings().then((result) => {
      setSettings(result);
      reloadOwnAppearance(result.loggedInUserId);
    });
    window.api.getProfile().then((result) => {
      if (result) setProfileState(result);
    });
    const unsubscribes = [
      window.api.onAuthToken(() => {
        window.api.getSettings().then((result) => {
          setSettings(result);
          reloadOwnAppearance(result.loggedInUserId);
        });
        setLoginError(null);
      }),
      window.api.onAuthError((reason) => {
        if (reason === 'session_expired') {
          setLoginError(null);
          window.api.getSettings().then(setSettings);
          return;
        }
        setLoginError(reason === 'access_denied' ? 'Login was cancelled.' : 'Login failed - please try again.');
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
      setLoginError('Could not reach the login page - check the server address in Settings and try again.'),
    );
  }

  // Optimistic local settings update; `persist` also writes through to the store.
  function handleSettingsChange(partial, persist) {
    setSettings((s) => ({ ...s, ...partial }));
    if (persist) window.api.setSettings(partial);
  }

  return (
    <div className="launcher-root">
      <TitleBar title="Disco" />
      <div className="aurora-stage">
        {page === 'main' && <img className="launcher-bg-image" src={backgroundImage} alt="" />}
        <div className="aurora-backdrop">
          <Aurora colorStops={AURORA_COLOR_STOPS} speed={0.4} />
        </div>
        {page === 'main' && settings.hasSessionToken && <h1 className="launcher-welcome">✧ Welcome back! ✧</h1>}
        {page === 'settings' ? (
          <SettingsView
            settings={settings}
            onSettingsChange={handleSettingsChange}
            onBack={() => {
              setPage('main');
              reloadOwnAppearance(settings.loggedInUserId);
            }}
          />
        ) : page === 'about' ? (
          <AboutView onBack={() => setPage('main')} />
        ) : (
          <>
            <div className="launcher-content">
              {loginError && (
                <div role="alert">
                  <p>{loginError}</p>
                  <button onClick={handleLogin}>Retry</button>
                </div>
              )}
              {settings.hasSessionToken ? (
                <>
                  <ProfileHeader
                    profile={profileState.profile}
                    reachable={profileState.reachable}
                    avatarMode={settings.avatarMode}
                    peekProfile={ownAppearance}
                  />
                  <BorderGlow className="start-chat-glow" backgroundColor="#6d5efc" borderRadius={8} glowRadius={14}>
                    <button className="launcher-primary-btn" onClick={() => window.api.startChatWindow()}>
                      <ChatIcon />
                      Start Chat Window
                    </button>
                  </BorderGlow>
                  <div className="launcher-button-row">
                    <button onClick={() => setPage('settings')}>
                      <SettingsIcon />
                      Settings
                    </button>
                    <button
                      className="launcher-danger-btn"
                      onClick={() => window.api.logout().then(() => window.api.getSettings().then(setSettings))}
                    >
                      <LogoutIcon />
                      Log out
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button onClick={() => setPage('settings')}>
                    <SettingsIcon />
                    Settings
                  </button>
                  <button onClick={handleLogin}>
                    <LoginIcon />
                    Login to Discord
                  </button>
                </>
              )}
            </div>
            <div className="launcher-info-box">
              <h3 className="launcher-info-title">How does this work?</h3>
              <p className="launcher-info-desc">Learn how Disco captions your voice channel.</p>
              <button onClick={() => setPage('about')}>Click me!</button>
            </div>
          </>
        )}
        {page === 'main' && <p className="launcher-version">v{settings.appVersion}</p>}
      </div>
    </div>
  );
}
