# Launcher background image

## Problem

Add the provided landscape artwork (`client/resources/background.png`) as a
background image on the launcher window's main page, sitting on top of the
existing solid background color and behind the animated Aurora glow.

## Scope

- Main launcher page only (not the Settings page, not the chat window).
- Image aligns to the bottom of `.aurora-stage` and spans its full width.
- Aspect ratio stays constant; the image grows/shrinks with the window so it
  always spans edge-to-edge and stays anchored to the bottom.

## Design

**Asset location:** copy `client/resources/background.png` into
`client/src/renderer/src/assets/background.png`, matching the existing
pattern for renderer-imported images (e.g. `titlebar-icon.png`).
`client/resources/` is electron-builder's build-resource folder, not a
runtime asset source, so the renderer must import its own copy.

**Rendering:** render the image as a plain `<img>` (not a CSS
`background-image`) inside `.aurora-stage`, positioned absolutely
(`left/right: 0; bottom: 0; width: 100%; height: auto`). An `<img>` with
`height: auto` preserves its native aspect ratio automatically on resize -
no resize listener needed (unlike the Aurora WebGL canvas, which already has
its own).

**Layering (bottom to top):**

1. `.launcher-root` solid `#0d0e11` background
2. New background image
3. `.aurora-backdrop` (Aurora glow, `opacity: 0.5`, unchanged)
4. Page content (`.launcher-content` / `.settings-view`, unchanged)

The image element is only rendered when `page === 'main'`, so it never
appears behind the Settings page.

**Overflow:** `.aurora-stage` already has `overflow: hidden`. If the scaled
image's height exceeds the stage height (e.g. a short/wide window), the
excess is clipped at the top, which reads as the image staying pinned to the
bottom - no special-casing needed.

## Out of scope

- Settings page, chat window: unchanged.
- No changes to the Aurora component itself.
