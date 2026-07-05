# Aurora background + foreground card design

## Goal

Add an animated aurora gradient background (blue → violet → blue) to the
launcher window and settings page, matching the ReactBits Aurora effect
(https://www.reactbits.dev/backgrounds/aurora?color1=7C3AED). It renders
behind a new bordered, rounded-corner foreground container that holds each
page's main content. The aurora is visible in the space around that
container, starting immediately below the title bar.

## Component: `Aurora`

New files: `client/src/renderer/src/Aurora.jsx`, `Aurora.css`.

Direct port of the ReactBits Aurora component — same approach already used
for `BorderGlow.jsx` ("Adapted from the ReactBits Border Glow component").
Renders a WebGL canvas via the `ogl` library (new dependency) running a
GLSL simplex-noise fragment shader that animates a flowing color-ramp
gradient across a `<canvas>` filling its container.

Props (matching upstream defaults):
- `colorStops` — array of 3 hex colors. We pass `['#3b82f6', '#7C3AED', '#3b82f6']`.
- `amplitude` (default `1.0`), `blend` (default `0.5`), `speed` (default `1.0`).

Behavior: mounts a WebGL renderer/program/mesh on mount, drives it with
`requestAnimationFrame`, listens for `window` resize to keep the canvas
sized to its container, and tears everything down (cancels the animation
frame, removes the resize listener, removes the canvas, loses the WebGL
context) on unmount. No React state — props are read through a ref each
frame so the animation loop doesn't need to restart when props change.

## Layout changes

Both the launcher window (`LauncherView.jsx`) and the settings page
(`SettingsView.jsx`) share one title bar and sit inside `.launcher-root`.

- New `.aurora-stage` wrapper is inserted directly below `TitleBar`,
  filling the remaining space (`flex: 1; min-height: 0; position: relative;
  overflow: hidden`). It contains the `Aurora` canvas and the page content
  (`launcher-content` or `SettingsView`) as siblings.
- `Aurora` is wrapped in a `.aurora-backdrop` div: `position: absolute;
  inset: 0; z-index: 0; pointer-events: none` — sits behind everything,
  never intercepts clicks or the title-bar drag region.
- `.launcher-content` (main window) and `.settings-scroll` (settings page)
  become the foreground container: `position: relative; z-index: 1`, a
  solid dark background (`#0d0e11`, matching the existing page background),
  a `1px` border (`rgba(255, 255, 255, 0.12)`), `border-radius: 14px`, and
  margin on all sides so the aurora frames it rather than touching edge to
  edge.
- Content already inside those containers (buttons, `.settings-section`
  cards, `.your-profile`, friend cards, etc.) is untouched — existing
  borders stay, nested inside the new outer card.
- `.settings-topbar` (back button + "Settings" title) stays outside/above
  the card with a transparent background, so the aurora is visible behind
  it too — consistent with the main window, which has no header row above
  its card.

## Out of scope

- The chat window / overlay (captions UI) is unaffected — this is launcher
  and settings only.
- No new configuration/settings for aurora colors or toggling it off.

## Testing

Purely visual/animation; no unit-testable logic beyond mount/unmount not
throwing (`BorderGlow.jsx`, the precedent for this pattern, also has no
test file). Verified by running the Electron app and visually confirming
the animation renders and resizes correctly in both the main window and
settings page.
