# Launcher welcome message, version footer, and window size

## Purpose

Three small changes to the launcher window:

1. A "Welcome back!" heading above the main container, for logged-in users.
2. A version number footer at the bottom of the window.
3. A larger default window size on open.

## 1. "Welcome back!" heading

- New element: `<h1 className="launcher-welcome">Welcome back!</h1>`, rendered
  in `.aurora-stage`, directly above `.launcher-content`.
- Visibility: `page !== 'settings' && settings.hasSessionToken` - hidden on
  the pre-login screen and on the Settings page.
- Style: centered, title-sized (28px / weight 700, matching the app's
  existing title sizing), with generous margin above and below (`32px 0
  24px`).

## 2. Version footer

- New element: `<p className="launcher-version">v{settings.appVersion}</p>`,
  rendered in `.aurora-stage`.
- Visibility: `page !== 'settings'` - visible on both the pre-login and
  logged-in main screen (not login-gated, since it's a general app footer);
  hidden on Settings.
- Style: centered, pinned to the bottom of the window via
  `position: absolute; bottom`, small/subtle text.
- Source of truth: `client/package.json`'s `"version"` field, starting at
  `"0.0.1"`. Read at runtime via Electron's `app.getVersion()` in
  `client/src/main/index.js`, added as `appVersion` to the existing
  `get-settings` IPC response (no new IPC channel - `LauncherView` already
  fetches settings on mount).

## 3. Larger default window size

- `createLauncherWindow` in `client/src/main/index.js` currently opens at
  `width: 440, height: 560`. Change to `width: 600, height: 640`.
- One-time default only - no change to resizability or persisted window
  state (the launcher window's size isn't currently persisted across
  launches, unlike the chat window's).

## 4. Dead code cleanup

- Remove the existing empty `<h1 className="launcher-title"></h1>` inside
  `.launcher-content` (renders nothing, unrelated leftover) and its unused
  `.launcher-title` CSS rule in `app.css`.

## 5. CLAUDE.md update

- Add a short note reminding future Claude sessions to bump the version in
  `client/package.json` whenever a release-worthy change is made, since that
  value now drives the displayed app version in the launcher.

## Files touched

- `client/package.json` - version bump to `0.0.1`
- `client/src/main/index.js` - add `appVersion: app.getVersion()` to
  `get-settings` handler; bump `createLauncherWindow`'s default
  `width`/`height` to `600`/`640`
- `client/src/renderer/src/LauncherView.jsx` - render welcome heading and
  version footer; remove dead `launcher-title` h1
- `client/src/renderer/src/assets/app.css` - add `.launcher-welcome` and
  `.launcher-version` rules; remove unused `.launcher-title` rule
- `CLAUDE.md` - add version-bump reminder

## Out of scope

- No changes to `client/package-lock.json` version pinning beyond what `npm`
  requires for the `package.json` edit (this is a manual version bump, not a
  dependency change).
- No automated version-bump tooling/CI - purely a manual convention captured
  in `CLAUDE.md`.
