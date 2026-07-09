# About Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "How does this work?" info box to the main launcher page that
navigates to a new (currently blank) About page.

**Architecture:** Pure client-side React state change inside the existing
`LauncherView.jsx` page-switch pattern (`page` state: `'main' | 'settings'`
already toggles between the main content and `SettingsView`). Extend `page`
to a third value, `'about'`, add a new `AboutView.jsx` component that reuses
`SettingsView`'s existing page-shell CSS classes, and add a new
`.launcher-info-box` container to the main page. No IPC, no main-process
changes, no new dependencies.

**Tech Stack:** React 19 (renderer), plain CSS in `app.css` (no CSS
modules/styled-components in this codebase), electron-vite dev server for
manual verification.

## Global Constraints

- Left-aligned content inside the info box (title, description, button).
- Info box background must be more transparent than `.launcher-content`'s
  `rgba(13, 14, 17, 0.88)` - spec value: `rgba(13, 14, 17, 0.55)`.
- About page body is intentionally blank except for the title - no other
  content in this change.
- Reuse `SettingsView`'s existing `.settings-view` / `.settings-topbar` /
  `.settings-topbar-inner` / `.settings-back-btn` / `.settings-title` CSS
  classes for `AboutView` - no new CSS for the page shell.
- Info box, background image, welcome text, and version footer are all
  visible only when `page === 'main'` (hidden on both `'settings'` and
  `'about'`).

---

### Task 1: Info box + About page + routing

**Files:**

- Create: `client/src/renderer/src/AboutView.jsx`
- Modify: `client/src/renderer/src/LauncherView.jsx`
- Modify: `client/src/renderer/src/assets/app.css`

**Interfaces:**

- Consumes: none new - uses existing `window.api` surface already imported
  in `LauncherView.jsx` (no new IPC calls).
- Produces: `AboutView` component with prop `onBack: () => void` (matches
  `SettingsView`'s existing `onBack` prop shape, `client/src/renderer/src/settings/SettingsView.jsx:6`).

This is one task because the info box's button and the About page it
navigates to are only manually verifiable together - there's no meaningful
intermediate state a reviewer could approve/reject in isolation.

- [ ] **Step 1: Create `AboutView.jsx`**

Create `client/src/renderer/src/AboutView.jsx`:

```jsx
export default function AboutView({ onBack }) {
  return (
    <div className="settings-view">
      <div className="settings-topbar">
        <div className="settings-topbar-inner">
          <button className="settings-back-btn" onClick={onBack}>
            ‹ Back
          </button>
          <h2 className="settings-title">About</h2>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add `.launcher-info-box` CSS**

In `client/src/renderer/src/assets/app.css`, add immediately after the
`.launcher-content` rule block (after the closing brace at line 310, before
`.launcher-welcome` at line 312):

```css
.launcher-info-box {
  position: relative;
  z-index: 1;
  flex: none;
  width: calc(100% - 40px);
  max-width: 480px;
  margin: 0 auto 14px;
  padding: 16px 20px;
  background: rgba(13, 14, 17, 0.55);
  border: 1px solid rgb(208, 167, 255);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  text-align: left;
}

.launcher-info-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.launcher-info-desc {
  margin: 0;
  font-size: 12px;
  opacity: 0.6;
}
```

- [ ] **Step 3: Wire routing and the info box into `LauncherView.jsx`**

In `client/src/renderer/src/LauncherView.jsx`:

1. Add the import near the top (after the `SettingsView` import at line 3):

```jsx
import AboutView from './AboutView';
```

2. Replace every `page !== 'settings'` conditional with `page === 'main'`
   (three occurrences: the background image at line 140, the welcome text
   at line 144, and the version footer at line 204).
3. Replace the `page === 'settings' ? (...) : (...)` ternary (lines
   145–203) with a 3-way branch, and add the info box right after the
   closing `</div>` of `.launcher-content` (still inside the `page === 'main'` branch):

```jsx
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
```

Note: the main-page branch is now wrapped in a fragment (`<>...</>`)
because it renders two sibling top-level elements (`.launcher-content` and
the new `.launcher-info-box`), where before it was just the single
`.launcher-content` div.

- [ ] **Step 4: Lint**

Run: `cd client && npm run lint`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `cd client && npm run dev`

In the launcher window that opens:

- Confirm the info box appears below the main container and above the
  version footer, left-aligned, with a visibly more transparent background
  than the main container.
- Click "Click me!" - confirm it navigates to the About page (title
  "About" visible, `‹ Back` button present, otherwise blank body).
- Confirm the info box, background image, welcome text, and version footer
  are all hidden while on the About page.
- Click `‹ Back` - confirm it returns to the main page with the info box,
  welcome text, background image, and version footer all restored.
- Click into Settings and back - confirm no regression (Settings still
  works, main page still restores correctly).

- [ ] **Step 6: Commit**

```bash
git add client/src/renderer/src/AboutView.jsx client/src/renderer/src/LauncherView.jsx client/src/renderer/src/assets/app.css
git commit -m "feat: add About page and main-page info box"
```
