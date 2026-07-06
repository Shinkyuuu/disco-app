# Settings page: inline, no window resize - design

## Purpose

Opening Settings currently resizes the launcher window from 440×560 to
640×560, then shrinks it back to 440×560 on close
(`client/src/renderer/src/settings/SettingsView.jsx`). This reads as if a
separate window opened, even though Settings is already just a page swap
inside the same `LauncherView` component tree. It should feel like
navigating within one window, with no size change.

This supersedes the "explicitly out of scope" note in
`docs/superpowers/specs/2026-07-04-launcher-window-layout-design.md`, which
kept Settings on a fixed 640-wide layout specifically because of this
resize behavior.

## Design

1. **Remove the forced resize.** Delete the `useEffect` in `SettingsView.jsx`
   that calls `window.api.resizeWindow(640, 560)` on mount and
   `window.api.resizeWindow(440, 560)` on unmount. Settings renders at
   whatever size the launcher window currently is - no IPC resize call at
   all on entering/leaving the page.

   The launcher window is already user-resizable (no `resizable: false` or
   width constraints in `createLauncherWindow`, `client/src/main/index.js`),
   so a user who wants more room for Settings' denser rows can drag the
   window wider themselves.

2. **Match the main page's side-gutter pattern, with a wider cap.**
   `.launcher-content` (main page, `client/src/renderer/src/assets/app.css`)
   centers its content in a column: `max-width: 480px`, `margin: 0 auto`,
   `padding: 32px 20px 20px`. `.settings-scroll` currently has flat
   `padding: 12px 14px` and no max-width, so it stretches edge-to-edge.

   Change `.settings-scroll` to the same centering pattern - `margin: 0
   auto`, 20px side padding - but with `max-width: 640px` instead of 480px
   (640 matches the width Settings used to force via resize, a known-good
   fit for the friend-card/slot-row layouts).

   Net effect: at the current default 440px window width, this is visually
   a no-op difference from today (440 is under both caps - just a 20px
   gutter instead of 14px). If the user drags the window wider, the main
   page stays capped/centered at 480px while Settings can use up to 640px
   before it also centers with margin.

   `.settings-topbar` (the Back button bar) is unchanged - it's a toolbar
   strip, not content, and wasn't part of the ask.

## Files touched

- `client/src/renderer/src/settings/SettingsView.jsx` - remove the
  resize-on-mount/unmount `useEffect`
- `client/src/renderer/src/assets/app.css` - `.settings-scroll` gutter/cap
  change

## Out of scope

- No change to the launcher window's default construction size (still
  440×560) or to any `resizable`/min-width constraints.
- No change to `.settings-topbar`, `.settings-section`, or any of the
  section components' internal layout.
- No change to the main page (`.launcher-content`) - already centered per
  the prior design doc.

## Verification

- Manual: open Settings from the main page - window size does not change,
  no visible resize jump.
- Manual: go Back to the main page - window size still unchanged.
- Manual: drag the launcher window wider, open Settings, confirm its
  content column grows up to ~640px before centering with margin (wider
  than the main page's 480px cap at the same window width).
- Manual: at the default 440px width, confirm Settings' side spacing looks
  consistent with the main page's gutter.
