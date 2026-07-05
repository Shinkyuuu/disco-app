# Launcher visual redesign (main page + Settings) — design

## Purpose

The launcher window (main page and Settings) currently mixes a Discord-blurple
accent, flat filled section cards, an inline "Settings" title crammed next to
the Back button, and a visible layout bug (no perceptible gap below the
"Start Chat Window" glow button, in the profile-unreachable state
specifically). The goal is a cohesive "professional and modern" pass across
both screens — new accent color, clearer typographic hierarchy, outlined
cards, a proper Settings page header, and a real fix for the spacing bug —
while keeping the existing dark theme and the existing functional flow
(same pages, same sections, same controls) untouched.

**Explicitly out of scope:** the chat overlay window (`ChatView.jsx`,
`SpeakerStrip.jsx`, `MessageLog.jsx`) and its CSS — this redesign covers only
the launcher window (main page + Settings). The `BorderGlow` component's
internal animated mesh-gradient effect is kept as-is (not recolored, not
removed) per explicit decision — only its container's spacing is fixed.

## Design

### 1. Design tokens

- **Accent color:** replace every use of Discord blurple `#5865f2` with
  `#6d5efc` (indigo/violet). Applies to: `.launcher-root` border,
  `.your-profile` border, `.profile-header-tag--active` background/border/text,
  and new hover/focus states introduced below. Backgrounds are unchanged
  (`#0d0e11` page background, etc.) — this is an accent swap, not a new
  palette.
- **Page title:** 20px, weight 700, margin 0. New style, used once per page
  (Settings' "Settings" title — the main page has no equivalent title today
  and none is being added).
- **Section label:** the existing `.settings-heading` CSS class (currently
  16px/600) is restyled in place — same class name, same JSX usage in
  `SettingsView.jsx`/`YourProfileSection.jsx`/`DefaultSlotsSection.jsx`/
  `FriendOverridesSection.jsx` (no JSX changes needed) — to 12px, uppercase,
  `letter-spacing: 0.04em`, `opacity: 0.6`, weight 600. Used for "Connection",
  "Your Profile", "Default Slots (10)", "Friend Overrides" — unchanged in
  position (still sits above its card).

### 2. Settings page header

- `.settings-topbar` changes from a single flex row (`← Back` button next to
  the `Settings` title) to two stacked rows:
  - Row 1: an icon-only back button (a `←` glyph, no "Back" text), compact,
    top-left.
  - Row 2: the "Settings" page title (new Page title style above), with its
    own padding beneath row 1.
- `SettingsView.jsx`'s topbar JSX restructures accordingly (button becomes
  icon-only; title moves to its own block below rather than beside it).

### 3. Card style — outlined, not filled

- `.settings-section` changes from `background: #26272d` (filled) to
  `background: transparent` (shows the page's `#0d0e11` through) with
  `border: 1px solid rgba(255, 255, 255, 0.08)`.
- `.your-profile` (the accent-bordered variant) keeps its distinct border,
  now `#6d5efc` (the new accent) instead of `#5865f2` — visually still
  "the same treatment, new color," not a new pattern.
- `.profile-header` (main page) gets the same outlined treatment for
  consistency across both screens: `background: transparent`,
  `border: 1px solid rgba(255, 255, 255, 0.08)` (it currently has
  `background: #26272d` and no border).

### 4. Main page accent + button consistency

- `.profile-header-tag--active` ("In voice channel" pill): background/border/
  text recolor from blurple-based values to the new `#6d5efc` accent (same
  opacity/tint approach as today, new hex).
- Secondary buttons — the global `button` hover state, plus specifically the
  Settings/Log out row and the new icon-only Back button — gain a hover/focus
  `border-color: #6d5efc` instead of the current plain background-lighten-only
  hover. The existing background-lighten hover stays; the border-color change
  is additive, not a replacement.
- `.launcher-danger-btn` (Log out) is unchanged (its red is a semantic
  danger color, not the accent, and wasn't part of the ask).

### 5. Spacing fix for the glow button

- Root cause: `.border-glow-card` (`BorderGlow.css`) has `overflow: visible`
  and a 6-layer `box-shadow` that visually extends well past its own box.
  Box-shadow doesn't occupy layout space, so `.launcher-content`'s flex
  `gap: 10px` between the glow card and the next element never actually
  clears the shadow's visible bleed — this is true in every state
  (profile-reachable, unreachable, not-found), not just the one you
  originally reported.
- Fix: add `margin-bottom: 20px` to the existing `.start-chat-glow` class
  (already present on the `BorderGlow` wrapper in `LauncherView.jsx`, used
  today only for background/radius overrides). This is real layout space on
  top of the flex gap, sized to clear the shadow's visual reach, so there's
  an unambiguous gap before the Settings/Log out row underneath in every
  profile state.
- The `BorderGlow` component itself (`BorderGlow.jsx`, `BorderGlow.css`) is
  not modified — no recoloring, no shadow-intensity changes, no prop changes.

## Files touched

- `client/src/renderer/src/assets/app.css` — token values (accent color,
  page-title/section-label styles), `.settings-section`/`.your-profile`/
  `.profile-header` card style, `.settings-topbar` layout, button hover
  states, `.start-chat-glow` margin, `.launcher-root` border color
- `client/src/renderer/src/settings/SettingsView.jsx` — topbar JSX
  restructure (icon-only back button + title on its own row)
- `client/src/renderer/src/LauncherView.jsx` — not touched (the
  `.start-chat-glow` class already exists on the right element; no other
  change from this spec applies here)

## Out of scope

- Chat overlay window (`ChatView.jsx`, `SpeakerStrip.*`, `MessageLog.jsx`)
  and its CSS.
- `BorderGlow.jsx`/`BorderGlow.css` internals (the animated glow/mesh-gradient
  effect itself, its default `colors` prop, shadow layer count/intensity).
- Any change to page structure, navigation flow, or functional behavior —
  this is a visual-only pass. Settings still has the same four sections in
  the same order; the main page still has the same login/logged-in branches.
- Font family (stays the existing system-font stack).
- `.launcher-danger-btn` (Log out button) color.

## Verification

- Manual: open the app, confirm the window border and "In voice channel" tag
  render in the new indigo `#6d5efc`, not blurple.
- Manual: open Settings, confirm the icon-only back button sits alone above
  a large bold "Settings" title, and all four section cards are outlined
  (transparent background, thin border) rather than filled gray.
- Manual: confirm "Connection"/"Your Profile"/"Default Slots (10)"/"Friend
  Overrides" render as small uppercase muted labels, not 16px bold headings.
- Manual: on the main page, in both the normal logged-in state and the
  "Server unreachable" state, confirm there is a clearly visible gap between
  the "Start Chat Window" button (including its glow) and the Settings/Log
  out row beneath it.
- Manual: confirm `ProfileHeader`'s card is now outlined/transparent instead
  of filled gray, matching the Settings cards.
