# About page: info box on main page + blank About page - design

## Purpose

Add a way for users to reach an (initially blank) "About" page from the
main launcher page, explaining "how this works." This is a placeholder for
future onboarding/explainer content - for now it's just the entry point and
the empty destination page.

## Design

1. **Info box on the main page.** In `LauncherView.jsx`, add a new
   `.launcher-info-box` container between `.launcher-content` and
   `.launcher-version`, visible only on the main page (`page === 'main'`).

   Left-aligned contents:
   - Title: `"How does this work?"`
   - Smaller/dimmer description line below it (placeholder copy, e.g.
     `"Learn how Disco captions your voice channel."`)
   - A `"Click me!"` button below that, which calls `setPage('about')`

   Styling (`app.css`): same width/centering/border-radius pattern as
   `.launcher-content` (480px max-width, centered), but with a more
   transparent background - `rgba(13, 14, 17, 0.55)` vs. `.launcher-content`'s
   `rgba(13, 14, 17, 0.88)`.

2. **New About page.** New file `AboutView.jsx` (sibling to
   `LauncherView.jsx`), mirroring `SettingsView.jsx`'s page-shell structure:
   reuses the existing `.settings-view` / `.settings-topbar` /
   `.settings-topbar-inner` / `.settings-back-btn` / `.settings-title` CSS
   classes - no new CSS needed for the page shell itself.

   Contents: a `‹ Back` button (calls `onBack`) and an `"About"` title.
   Nothing else for now - body is intentionally blank, to be filled in
   later.

3. **Routing in `LauncherView.jsx`.** `page` state extends from
   `'main' | 'settings'` to `'main' | 'settings' | 'about'`.

   The existing `page === 'settings' ? <SettingsView/> : (...)` ternary
   becomes a 3-way branch (`settings` → `SettingsView`, `about` →
   `AboutView`, else → main content).

   Conditionals currently keyed on `page !== 'settings'` (background image,
   welcome text, version footer) change to `page === 'main'`, since those
   should also hide on the About page, matching how they already hide on
   Settings.

## Files touched

- `client/src/renderer/src/LauncherView.jsx` - new info box, 3-way page
  routing, updated visibility conditionals
- `client/src/renderer/src/AboutView.jsx` - new file, About page shell
- `client/src/renderer/src/assets/app.css` - new `.launcher-info-box` (and
  title/description) rules

## Out of scope

- Actual "how this works" content on the About page - blank with just a
  title for now.
- Any change to `SettingsView.jsx` or its CSS classes beyond reusing them
  as-is for `AboutView`.
- Placeholder description copy is not final - wording can change later
  without a design update.

## Verification

- Manual: on the main page, confirm the info box appears below the main
  container and above the version footer, left-aligned, with a visibly more
  transparent background than the main container.
- Manual: click "Click me!" - navigates to the About page (title visible,
  `‹ Back` button present, otherwise blank).
- Manual: click `‹ Back` on the About page - returns to the main page with
  the info box, welcome text, background image, and version footer all
  restored.
- Manual: confirm the info box, background image, welcome text, and version
  footer are all hidden while on the About page (matching current Settings
  behavior).
