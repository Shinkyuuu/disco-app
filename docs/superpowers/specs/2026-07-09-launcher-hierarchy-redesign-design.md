# Launcher main window hierarchy redesign - design

## Purpose

The launcher's main screen currently reads as a hobby project rather than a
professional app: a giant sparkle "✧ Welcome back! ✧" heading floats above a
nested box-in-box profile card, the primary "Start Chat Window" action sits
inside the same visual container as secondary buttons with no weight
difference, "Log out" is styled as a destructive/error action, and the
peeking custom-avatar + speech-bubble touch overlaps awkwardly above the
profile card. This redesign fixes the visual hierarchy and composition of the
main screen (logged-in and logged-out states) while keeping the color
palette, Aurora background effect, background art, fonts, and the "About the
Disco App" box completely untouched (explicit decisions, confirmed during
brainstorming).

## Design

### 1. Single combined card (unchanged in spirit)

Logged-in and logged-out states each render one card (`.launcher-content`,
existing element) containing everything: kicker label, identity, primary CTA,
secondary actions, and (logged-in + custom avatar mode only) the avatar/
speech-bubble companion row. This matches the current structure - the change
is internal composition, not container count. The "About the Disco App" card
stays exactly as it is today: same size, same position below `.launcher-
content`, same copy, untouched.

### 2. Kicker label replaces the standalone welcome heading

Remove the standalone `<h1 className="launcher-welcome">✧ Welcome back!
✧</h1>` currently rendered above `.launcher-content` in `.aurora-stage`
(added by the `2026-07-07-launcher-welcome-and-version-design` spec). Replace
it with a small label *inside* the card, directly above the identity row:
"Welcome back" (logged-in) or "Get started" (logged-out) - uppercase, small,
muted (new `.launcher-kicker` class: ~11px, `letter-spacing: 0.04em`,
`opacity: 0.6`, weight 600 - modeled on the existing `.settings-heading`
treatment for visual consistency with Settings). No sparkle glyphs.

### 3. Flat identity row (logged-in only)

`ProfileHeader.jsx`'s `.profile-header` box currently has its own background
(`#26272d`) and `border-radius`, i.e. a box nested inside the outer card.
Remove that nested-box styling - `.profile-header` becomes a plain flex row
(avatar + name/tag stack) with no background, no border, sitting directly in
the card's content flow. The three existing states (normal / "Server
unreachable - retrying…" spinner / "Not found in the Discord server") keep
their current logic, just rendered without the nested box. Avatar shrinks
modestly (72px → ~56px) to suit the flatter, more compact row.

A thin divider (new `.launcher-divider`: 1px, `rgba(255,255,255,0.08)`) sits
between the identity row and the primary button, replacing the row's current
`margin-bottom` as the section break.

### 4. Primary CTA stays visually dominant, secondary actions go neutral

"Start Chat Window" keeps its current treatment as-is: full width, `Border-
Glow` wrapper, glow shadow (`BorderGlow.jsx`/`.css` untouched per the prior
redesign's explicit decision). Below it, the Settings/Log out row
(`.launcher-button-row`) stays a two-button row, but **Log out drops the red
`.launcher-danger-btn` treatment** - it becomes a plain secondary button,
identical weight to Settings. Reasoning: logging out is a routine, reversible
action, not a destructive one; styling it like an error invites hesitation it
doesn't need. (Applies to the logged-in state only - the danger class isn't
used anywhere else.)

### 5. Avatar/speech-bubble companion moves to its own row, no longer overlapping

Today, `ProfileHeader.jsx` renders a "peeking" custom-avatar image
absolutely-positioned to overlap the *top* of the profile box (`padding-top:
152px` reserved above, avatar overlaps down into it), alongside a
`SpeechBubble` with hardcoded, typewriter-animated inside-joke lines. This is
**not** a fixed app mascot - it's the logged-in user's own custom avatar
preview, gated on `avatarMode === 'custom'` (an "avatarSilent" image renders
the peek avatar; the speech bubble renders whenever `avatarMode === 'custom'`
regardless of whether custom art is set).

This design keeps that logic and behavior exactly as implemented, but
relocates it: instead of overlapping above the identity row, it becomes a
plain, non-overlapping companion row (avatar image + speech bubble side by
side, new `.profile-companion` class) placed *after* the Settings/Log out
row, before the bottom of the card. Only rendered when `avatarMode ===
'custom'`; entirely absent for `avatarMode === 'discord'` users and for the
logged-out state.

**Note on a tradeoff:** the current overlap sizing intentionally mirrors the
chat overlay window's avatar/panel overlap ratio (per the existing code
comment in `app.css`), functioning as a rough preview of how the avatar
overlaps the live caption panel. Moving to a plain non-overlapping row drops
that specific "live preview" nuance in exchange for fitting cleanly into the
combined-card layout. Flag this during spec review if that preview behavior
should be preserved instead.

### 6. Component boundaries

- `ProfileHeader.jsx` - simplified to *only* the identity row (normal /
  unreachable / not-found states). Drops the `peekProfile` prop and all
  peek-avatar/speech-bubble rendering.
- New file `ProfileCompanion.jsx` - renders the avatar + `SpeechBubble` row
  described in #5, reusing the existing `resolveAppearance()` logic verbatim
  (moved from `ProfileHeader.jsx`). Takes `avatarMode`, `peekProfile`, and
  `discordAvatarURL` (for the existing fallback behavior).
- `LauncherView.jsx` renders the kicker, `ProfileHeader`, divider, primary
  button, secondary row, and (conditionally) `ProfileCompanion` in that
  order, all inside `.launcher-content`. It already holds `ownAppearance`
  and `settings.avatarMode`, so no new data plumbing is needed.
- `SpeechBubble.jsx` and `typewriter.js` are unchanged.

### 7. Logged-out state gets the same treatment

Kicker reads "Get started" instead of "Welcome back". No identity row (no
profile yet) and no companion row (no custom avatar to preview pre-login).
"Login to Discord" becomes the primary CTA (same `BorderGlow`/glow treatment
as "Start Chat Window" today, which it currently lacks - today both Settings
and Login are plain equal-weight buttons). Settings becomes a single
secondary button below it, matching the visual weight Settings has in the
logged-in state.

The existing login-error alert (`role="alert"` block with the Retry button)
is unaffected - it continues to render above the rest of the card content,
same as today.

## Files touched

- `client/src/renderer/src/LauncherView.jsx` - remove standalone
  `.launcher-welcome` h1; restructure logged-in and logged-out JSX branches
  per #2-7 (kicker, divider, neutral Log out button, primary-CTA treatment
  for Login, conditional `ProfileCompanion`)
- `client/src/renderer/src/ProfileHeader.jsx` - drop peek-avatar/speech-
  bubble rendering and the `peekProfile` prop; flatten `.profile-header` to
  a plain row (identity states only)
- `client/src/renderer/src/ProfileCompanion.jsx` - new file, extracted
  peek-avatar + `SpeechBubble` rendering
- `client/src/renderer/src/assets/app.css` - remove `.launcher-welcome`,
  `.profile-header-block--peeking`, `.profile-header-block--custom`,
  `.profile-peek-avatar`, `.profile-speech-bubble` overlap positioning, and
  `.profile-header`'s box styling; add `.launcher-kicker`,
  `.launcher-divider`, `.profile-companion`; remove `.launcher-danger-btn`
  usage from the Log out button (class itself can stay if still referenced
  elsewhere, otherwise remove)

## Out of scope

- Color palette, Aurora background effect, `background.png`/
  `about_container_background.png` art, fonts, title bar - all unchanged.
- The "About the Disco App" card - unchanged in size, position, copy, and
  styling (explicit decision).
- `BorderGlow.jsx`/`BorderGlow.css` internals - unchanged.
- `SpeechBubble.jsx` message content and `typewriter.js` - unchanged.
- Settings page and About page layouts - not touched by this spec.
- Window sizing/resizability - unchanged.

## Verification

- Manual, `avatarMode: 'discord'`, logged in: card shows small "Welcome
  back" kicker, flat identity row (no nested box), divider, glowing "Start
  Chat Window" button, then a neutral (non-red) Settings/Log out row, no
  companion row. About box below is unchanged.
- Manual, `avatarMode: 'custom'` with `avatarSilent` set: companion row
  (peeking avatar image + animated speech bubble) appears after the
  Settings/Log out row, non-overlapping.
- Manual, `avatarMode: 'custom'` without `avatarSilent` set: speech bubble
  still renders (no avatar image) in the same companion-row position.
- Manual, logged out: kicker reads "Get started", no identity row, "Login to
  Discord" has the same glow treatment "Start Chat Window" has today,
  Settings renders as a single secondary button beneath it.
- Manual: "Server unreachable" and "Not found in the Discord server" states
  still render their spinner/message in place of the identity row.
- Manual: trigger a login error - the existing Retry alert still renders
  correctly above the rest of the card.
