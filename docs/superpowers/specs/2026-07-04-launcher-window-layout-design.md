# Launcher window layout - design

## Purpose

The launcher window's main screen (login / logged-in view) currently stretches
its content to fill the full window width, and its buttons are a flat vertical
stack of equal-weight buttons. This looks awkward if the window is widened or
maximized, and doesn't give "Start Chat Window" - the primary action - visual
priority over "Settings" / "Log out".

## Scope

Applies to the launcher's main screen only (`LauncherView.jsx`'s login and
logged-in branches, both rendered inside `.launcher-content`).

**Explicitly out of scope:** the Settings page (`SettingsView.jsx`). It already
resizes the window to a fixed 640×560 while open, specifically because its
card/row-based content wants that width, then restores the previous size on
close. Centering it with a narrow max-width would fight that existing
behavior, so it keeps its current full-width layout.

## Design

1. **Centered content on wide windows** - `.launcher-content` (in
   `client/src/renderer/src/assets/app.css`) gets `max-width: 380px`,
   `margin: 0 auto`, `width: 100%`. On the default/narrow window this is a
   no-op (content already fills the width); if the user widens or maximizes
   the window, content stays centered with margin on both sides instead of
   stretching edge-to-edge.

2. **Button layout (logged-in branch only)** - in
   `client/src/renderer/src/LauncherView.jsx`:
   - "Start Chat Window" becomes a larger, primary-style, full-width button
     (bigger padding/font).
   - "Settings" and "Log out" move into a row below it, side by side, each
     `flex: 1`.
   - The logged-out branch (Settings + Login) is unchanged in structure.

3. **Default window size** - the taller button stack needs more vertical
   room, so the launcher window's default size changes from 360×480 to
   360×560 in `createLauncherWindow` (`client/src/main/index.js`).
   `SettingsView.jsx` already hardcodes a resize-back-to-launcher-size call
   (`window.api.resizeWindow(360, 480)`) when it unmounts - this existing
   duplicate of the default size must be updated to `360, 560` in the same
   change, or closing Settings would shrink the window back to the old size.

## Files touched

- `client/src/renderer/src/assets/app.css` - `.launcher-content` centering
- `client/src/renderer/src/LauncherView.jsx` - button markup/structure for the
  logged-in branch, plus corresponding CSS classes for the primary button and
  button row
- `client/src/main/index.js` - default launcher window height
- `client/src/renderer/src/settings/SettingsView.jsx` - restore-size constant
  kept in sync with the new default

## Verification

- Manual: launch the app, confirm the logged-in screen shows a large "Start
  Chat Window" button with "Settings"/"Log out" in a row beneath it.
- Manual: resize/maximize the launcher window and confirm content stays
  centered with margins rather than stretching full width.
- Manual: open Settings, then go back, and confirm the window returns to the
  new default size (360×560), not the old 360×480.
