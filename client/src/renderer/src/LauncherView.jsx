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
import TitleBar from './TitleBar';
import ErrorBanner from './ErrorBanner';
import SettingsView from './settings/SettingsView';
import AboutView from './AboutView';
import ProfileHeader from './ProfileHeader';
import ProfileCompanion from './ProfileCompanion';
import BorderGlow from './BorderGlow';
import Aurora from './Aurora';
import backgroundImage from './assets/background.png';
import aboutContainerBackground from './assets/about_container_background.png';

const AURORA_COLOR_STOPS = ['#3b82f6', '#7C3AED', '#3b82f6'];
const BANNER_VISIBLE_MS = 4000;

const OPEN_FAILURE_MESSAGES = {
  'auth-failed': (state) => (state.code === 4001
    ? 'You need to be in the voice channel being captioned.'
    : 'Your session expired - please log in again.'),
  unreachable: (state) => `Can't reach ${state.serverAddress} - the server isn't responding.`,
  'session-ended': () => 'The bot left the voice channel - captioning has stopped.',
};

function describeOpenFailure(state) {
  return OPEN_FAILURE_MESSAGES[state.status]?.(state) ?? "Couldn't open the chat window - try again.";
}

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
  const [banner, setBanner] = useState(null);
  const [profileState, setProfileState] = useState({ reachable: true, profile: null });
  const [ownAppearance, setOwnAppearance] = useState(null);
  const [chatOpening, setChatOpening] = useState(false);

  // Every main-window error (login failure, chat-window open failure) shows
  // through this one shared banner, auto-dismissing after BANNER_VISIBLE_MS.
  // Keyed on the message string itself so a new, different error arriving
  // before the old one has cleared restarts the timer instead of leaving it
  // to expire early against the new message.
  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), BANNER_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [banner]);

  function reloadOwnAppearance(userId) {
    if (!userId) return;
    Promise.all([
      window.api.resolveSpeakerProfile({ speakerId: userId, slotIndex: -1 }),
      window.api.getBroadcastAvatar().catch(() => ({ silentURL: null, speakingURL: null })),
    ]).then(([profile, broadcast]) => {
      setOwnAppearance({
        ...profile,
        avatarSilent: broadcast.silentURL ?? null,
        avatarSpeaking: broadcast.speakingURL ?? null,
      });
    });
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
        setBanner(null);
      }),
      window.api.onAuthError((reason) => {
        if (reason === 'session_expired') {
          setBanner(null);
          window.api.getSettings().then(setSettings);
          return;
        }
        setBanner(reason === 'access_denied' ? 'Login was cancelled.' : 'Login failed - please try again.');
      }),
      window.api.onOpenSettings(() => setPage('settings')),
      window.api.onProfile((result) => setProfileState(result)),
    ];
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, []);

  if (!settings) return null;

  // Governs the peeking-avatar/speech-bubble companion: shown for a
  // reachable, found, custom-avatar-mode profile. The avatar always renders
  // (falling back to the bundled mascot image), so the card always reserves
  // room for the full peeking companion.
  const showCompanion =
    settings.hasSessionToken && profileState.reachable && profileState.profile && settings.avatarMode === 'custom';

  function handleLogin() {
    setBanner(null);
    window.api.openLogin(settings.serverAddress).catch(() =>
      setBanner('Could not reach the login page - try again.'),
    );
  }

  async function handleStartChatWindow() {
    setChatOpening(true);
    setBanner(null);
    const result = await window.api.startChatWindow();
    // Reset regardless of outcome - on success the launcher is about to be
    // hidden by createChatWindow() anyway, but the launcher is only hidden,
    // not unmounted, so leaving this stuck true would show a permanently
    // disabled "Opening…" button the next time the launcher is shown again
    // (e.g. after the chat window later closes).
    setChatOpening(false);
    if (!result.opened) {
      setBanner(describeOpenFailure(result.state));
    }
  }

  // Optimistic local settings update; `persist` also writes through to the store.
  function handleSettingsChange(partial, persist) {
    setSettings((s) => ({ ...s, ...partial }));
    if (persist) window.api.setSettings(partial);
  }

  return (
    <div className="launcher-root">
      <TitleBar title="Disco" />
      {banner && <ErrorBanner key={banner} message={banner} onDismiss={() => setBanner(null)} />}
      <div className="aurora-stage">
        {page === 'main' && <img className="launcher-bg-image" src={backgroundImage} alt="" />}
        <div className="aurora-backdrop">
          <Aurora colorStops={AURORA_COLOR_STOPS} speed={0.4} />
        </div>
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
            <div className={`launcher-card-wrap${showCompanion ? ' launcher-card-wrap--peeking' : ''}`}>
              {showCompanion && (
                <ProfileCompanion avatarMode={settings.avatarMode} peekProfile={ownAppearance} />
              )}
              <div className="launcher-content">
                {settings.hasSessionToken ? (
                  <>
                    <p className="launcher-kicker">Welcome back</p>
                    <ProfileHeader profile={profileState.profile} reachable={profileState.reachable} />
                    <div className="launcher-divider" />
                    <BorderGlow className="launcher-cta-glow" backgroundColor="#6d5efc" borderRadius={8} glowRadius={14}>
                      <button className="launcher-primary-btn" disabled={chatOpening} onClick={handleStartChatWindow}>
                        <ChatIcon />
                        {chatOpening ? 'Opening…' : 'Start Chat Window'}
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
                    <p className="launcher-kicker">Get started</p>
                    <BorderGlow className="launcher-cta-glow" backgroundColor="#6d5efc" borderRadius={8} glowRadius={14}>
                      <button className="launcher-primary-btn" onClick={handleLogin}>
                        <LoginIcon />
                        Login to Discord
                      </button>
                    </BorderGlow>
                    <button onClick={() => setPage('settings')}>
                      <SettingsIcon />
                      Settings
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="launcher-info-box">
              <img className="launcher-info-bg-image" src={aboutContainerBackground} alt="" />
              <h3 className="launcher-info-title">About the Disco App!</h3>
              <p className="launcher-info-desc">Learn about Disco and how it works</p>
              <button onClick={() => setPage('about')}>Click me!</button>
            </div>
          </>
        )}
        {page === 'main' && <p className="launcher-version">v{settings.appVersion}</p>}
      </div>
    </div>
  );
}
