# Electron Client & Server Authorization - Design

Companion to [`system-design.md`](system-design.md), which describes the
eventual Electron overlay only in broad strokes. This document is the
concrete design for building it, plus the backend authorization work it
depends on. It supersedes `development-plan.md`'s Parts 5–8 as the client's
implementation - those parts (bare HTML overlay, attribution, UX polish) were
a deliberate stepping stone to validate the pipeline before investing in a
real desktop client, and that job is done.

## 1. Goal

Replace `overlay.html` with a real Electron+React desktop client, and add
access control so that only people the bot can actually hear (i.e. current
members of the voice channel being captioned) can view the transcription.
EC2 hosting (`development-plan.md` §4) is a separate, later effort - not
covered here.

## 2. Repo structure

The existing bot stays at the repo root - it doesn't need to move, and
splitting it out into its own directory buys nothing. It does need internal
reorganization: `index.js` is about to gain real auth logic on top of what's
already there, past the point where one file is the right shape for it.

- `bot.js` - Discord client, voice capture, per-speaker Deepgram streaming (today's `index.js` content, largely unchanged)
- `gateway.js` - HTTP server, WebSocket server, broadcast helpers, WS-connect authorization check
- `auth.js` - OAuth login/callback routes, opaque token issuance/verification
- `index.js` - thin entry point wiring the above together

`overlay.html` is deleted once the Electron client replaces it.

`client/` - new directory, the Electron+React app. Internal structure follows
whatever the chosen tooling scaffolds (see §4).

## 3. Backend changes

### 3.1 New env vars

- `DISCORD_CLIENT_SECRET` - from the Discord Developer Portal's OAuth2 tab, needed to exchange an OAuth code for a token.

You'll also need to register a redirect URI in that same OAuth2 settings
page: `http://localhost:3000/auth/callback` for local dev (update later
when EC2-hosted).

### 3.2 OAuth + authorization flow

1. `GET /auth/login` redirects to Discord's OAuth authorize URL, requesting only the `identify` scope. No `guilds` scope needed - the bot already knows who's in the voice channel from its own cached Discord data, so the user's token only needs to prove *who they are*, not what guilds they're in.
2. `GET /auth/callback?code=...` exchanges the code for a Discord access token (`POST https://discord.com/api/oauth2/token`), then calls `GET https://discord.com/api/users/@me` to get the Discord user ID.
3. The backend mints its own opaque session token (`crypto.randomBytes(32).toString('hex')`), stored in an in-memory `Map<token, {userId, expiresAt}>` (no new dependency, no persistence - if the bot restarts, everyone re-logs in, which is acceptable at this stage). Suggested TTL: 4 hours.
4. Redirect to `discord-echo://auth?token=...`. The Electron app has registered that custom protocol and catches the redirect.
5. The client stores the token (`electron-store`) and opens the WebSocket to
   `ws://host:port/` - **no token in the URL.** Query strings are routinely
   captured in proxy/server access logs regardless of transport, and this
   connection has no TLS in scope yet (§3.4), so the token shouldn't be in
   the one place (the URL) that gets logged by default. Immediately after
   the socket opens, the client sends the token as its first message:
   `{ "type": "auth", "token": "..." }`.
6. The gateway accepts the WS upgrade unconditionally, then waits for that
   first message (with a short timeout - e.g. 5s, closing with code `4008`
   / reason `"auth timeout"` if nothing arrives). On receipt, it looks up
   the token, checks it's unexpired, resolves the associated Discord user
   ID, and checks `guild.members.cache.get(userId)?.voice.channelId === trackedChannelId`.
   If any check fails, the connection is closed with a clear reason (e.g.
   close code `4001`, reason `"not in voice channel"`). Only after this
   passes does the server send the initial `roster` message and start
   forwarding `speaking`/`transcript` events - no captioning data is sent
   to an unauthenticated socket.
7. **Scope for this pass:** checked once, at connect time. If someone leaves the voice channel mid-session, their already-open client keeps working until they reconnect. Continuous re-verification (kicking active connections when someone leaves) is a deliberate non-goal for now - revisit if it proves to matter in practice.

This auth check happens once per connection, not per message, so it adds no
latency to the live captioning pipeline itself - the product's "well under
1s" speed priority is unaffected.

### 3.3 WebSocket message protocol

Every message gets a `type` discriminator:

```jsonc
// First message sent by the client, immediately after the socket opens (§3.2 step 5)
{ "type": "auth", "token": "..." }

// Sent on connect, and again whenever someone joins/leaves the tracked voice channel
{ "type": "roster", "members": [{ "speakerId": "...", "username": "...", "avatarURL": "..." }] }

// Fires immediately on Discord's own speaking-start/stop - no Deepgram round-trip delay
{ "type": "speaking", "speakerId": "...", "isSpeaking": true }

// Existing transcript broadcast, now tagged with a type
{ "type": "transcript", "speakerId": "...", "username": "...", "avatarURL": "...", "text": "...", "isFinal": true }
```

### 3.4 Transport security note

This design runs over plaintext `ws://` - there's no TLS anywhere in scope
for the current local-only deployment (bot and client on the same
machine/LAN, no untrusted network path to sniff). Moving the token out of
the URL and into an authenticated first message (§3.2 step 5) avoids
logging it in proxy/access logs, but doesn't protect it from network-level
interception on its own. This is an accepted, explicit risk for now - it
becomes non-negotiable to close once anything is hosted beyond localhost:
switch the client's default server scheme to `wss://` (the reverse proxy
already planned for EC2 hosting, `development-plan.md` §4.4's Caddy setup,
terminates TLS automatically - no backend code change needed).

Roster is sourced from `channel.members` (already cached via the
`GuildVoiceStates` intent) when `/captions start` runs, and kept in sync via
a `voiceStateUpdate` listener filtered to the tracked channel (registered on
`/captions start`, torn down on `/captions stop`).

## 4. Electron client

**Stack:** Vite + React, Electron main/renderer split via a preload script
using `contextBridge` (not `nodeIntegration` in the renderer - standard
Electron security practice, worth stating explicitly since this is a fresh
app). No state management library needed; `useState`/`useReducer` is enough
for this scope. `electron-store` for persisted settings. Packaging
(`electron-builder`) is out of scope for this pass - `npm run electron` /
dev mode only.

**Custom protocol (`discord-echo://`) and IPC:** protocol registration and
the OS-level redirect land in the Electron **main** process
(`app.setAsDefaultProtocolClient`, plus `open-url` on macOS / second-instance
argv parsing on Windows). The main process forwards the captured token to the
renderer over a dedicated IPC channel exposed through the preload script
(e.g. `window.api.onAuthToken(callback)`), since the renderer itself can't
observe OS-level protocol invocations directly.

Two platform-specific timing gotchas to account for, since both mean the
redirect can arrive before there's a window/IPC channel to forward it to:

- **macOS:** if the app wasn't already running, the OS launches it fresh via
  the protocol link, and `open-url` can fire *before* `app.ready`. The
  handler must stash the incoming URL and replay it once `ready` fires,
  rather than assuming a renderer is already listening.
- **Windows/Linux:** the redirect arrives via a second process launch, which
  `app.requestSingleInstanceLock()` detects and forwards to the *first*
  instance's `second-instance` event handler; the URL is the last entry in
  that handler's `argv` array. The same "may arrive before a window exists"
  case applies if the app was fully quit (not just backgrounded) when the
  link was clicked.

**Persisted settings (`electron-store`):** server address (host:port),
avatar mode (`discord` | `custom`), the session token.

### 4.1 Main window

Minimal launcher: a **Settings** button and a **Start Chat Window** button.
If there's no valid stored token, clicking **Start Chat Window** first runs
the login flow (opens the system browser via `shell.openExternal` to
`<server>/auth/login` - not an embedded webview, which is both a Discord
policy consideration and a general OAuth-in-native-apps best practice), then
proceeds once the token arrives via the protocol handler.

**Settings screen:** server address field, avatar mode toggle.

### 4.2 Chat window

Opens on **Start Chat Window**; the main window minimizes. Closing the chat
window restores the main window. The **WebSocket connection and accumulated
message log are owned by the Electron app, not the chat window's mount
lifecycle** - both stay alive in the background while the main window is
showing, so toggling between the two windows doesn't drop the connection,
re-trigger auth, or lose scrollback: reopening the chat window shows the
same log it had when closed. Both are cleared only on logout or app quit.

**Layout:**

- **Speaker icon strip** - left-aligned, no background container (per confirmed visual direction). Driven by `roster` (who to show) and `speaking` (visual state) events.
  - **Discord-avatar mode:** icons float with a gap above the window's top edge, drop-shadow underneath, full opacity, rendered in front of the window.
  - **Custom-image mode:** icons (your PNGs) start with *no* gap at the window's top edge and render *behind* the window (lower z-index), so the window's top edge clips the bottom portion - reads as the character peeking out from behind the window.
  - **Speaking state (both modes):** glow + slight rise/scale on `isSpeaking: true`, CSS transform/opacity only (GPU-friendly, no layout thrashing, per `system-design.md` §7's guidance). Idle state is just the un-glowing baseline - no third visual state.
- **Message log** - persistent, scrolling, chat-log style (confirmed: not the ephemeral fade-out behavior built for the browser overlay). Each **finalized utterance is its own line** (avatar + name + text), appended below prior lines. An in-progress (interim) utterance updates in place until finalized, then locks in as a permanent entry; the speaker's *next* utterance is a new line, not an overwrite. In-memory only for the session - not persisted to disk, cleared on app restart. (Named tension: `system-design.md`'s stated non-goal is archival accuracy/transcription-log behavior; an in-session, non-persisted scrollback is a normal chat-UI affordance and doesn't reintroduce that non-goal - but it's worth remembering if this ever grows toward "save my transcript," which would be a real scope change.)
- **Close control** - closes the chat window, restores the main window.

## 5. Error handling

- **OAuth denied / network failure during login:** show an error state on the main window with a retry action.
- **WS connection rejected (not in voice channel):** don't crash - show a clear message ("You need to be in the voice channel being captioned") with a retry/reconnect action, since the person might join the VC after opening the app.
- **Server unreachable:** connection error shown with the configured address, and a way to edit it (back to Settings).
- **WS drops mid-session (network blip):** auto-reconnect with backoff, reusing the stored token; re-fetch roster on reconnect since state may be stale.
- **Stored token expired (session token TTL passed, e.g. a chat window left open past 4h, or reconnect after a blip using a now-stale token):** the gateway's auth check (§3.2 step 6) rejects it same as an invalid token. Don't loop on auto-reconnect in this case - detect the auth-specific close/rejection and show the same "log in again" state as OAuth-denied, rather than retrying with a token that will never become valid again.

## 6. Explicit non-goals for this pass

- Transparent / always-on-top / click-through window behavior and system tray (confirmed: normal window first).
- Packaging, code signing, auto-updater.
- Multi-guild / multi-session backend support - there is exactly one global session; auth only gates "is this Discord user in the one tracked voice channel."
- Continuous re-verification of voice-channel membership (connect-time check only).
- Persisting the chat log to disk.

## 7. Suggested build sequence

Continuing the numbered-parts convention from `development-plan.md` /
`docs/status.md`:

- **Part 10 - Backend auth.** Split `index.js` into `bot.js`/`gateway.js`/`auth.js`. Add `/auth/login`, `/auth/callback`, token issuance, and the WS-connect authorization check. Verify with a manual browser-based OAuth round trip and a `wscat` connection carrying a valid vs. invalid token.
- **Part 11 - Protocol additions.** Add `roster` and `speaking` broadcast events. Verify by watching raw WS messages (e.g. via `wscat`) while people join/leave/speak in the voice channel.
- **Part 12 - Electron scaffold + login.** Vite+React+Electron scaffold, main window with Settings/Start buttons, custom protocol registration, OAuth flow wired end-to-end. Verify: clicking Start Chat Window with no stored token completes login and lands back in the app with a token.
- **Part 13 - Chat window core.** WebSocket connection (owned at the app level), persistent scrolling message log, roster-driven speaker strip (no speaking animation yet). Verify: two people talking in the VC produces two roster icons and a growing scrollback.
- **Part 14 - Speaking animation + avatar modes.** Wire the `speaking` event to the icon strip's visual state; implement both avatar-mode renderings (floating vs. peeking-from-behind) and the settings toggle. Verify against the confirmed mockup direction.
- **Part 15 - Error handling & reconnect.** All the states in §5. Verify each by deliberately triggering it (wrong server address, leaving the VC before connecting, killing the bot mid-session).

## 8. Open items for later (not blocking this design)

- EC2 hosting (`development-plan.md` §4) - once hosted, `DISCORD_CLIENT_SECRET`'s redirect URI and the client's default server address both need updating to the real host.
- If multi-guild/multi-session support is ever added, the auth model here (one global session) will need real session identifiers, and the OAuth scope may need to expand to `guilds` for routing.
