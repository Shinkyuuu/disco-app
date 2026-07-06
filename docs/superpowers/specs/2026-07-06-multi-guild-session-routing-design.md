# Multi-Guild Session Routing & Authorization - Design

**Status:** Approved, ready for implementation planning.
**Scope:** Backend only (`bot.js`, `gateway.js`, new `sessionRegistry.js`). No client code
changes required - new message fields are purely additive (see Section 7).

## 1. Goal

Today the bot/server assume exactly one Discord server (`DISCORD_SERVER_ID`) and one
globally tracked voice channel for the whole process. This removes that single-tenant
assumption so that:

- Any Discord server that invites the (single, shared) bot can independently run
  `/disco join` in its own voice channels.
- Multiple different Discord servers can have active caption sessions at the same time,
  fully isolated from each other.
- A viewer can only ever receive transcripts/roster/speaking events for the voice channel
  they are *currently, live* connected to - continuously enforced, not just checked once
  at connect time.
- The system stays within a configurable global cost cap on simultaneous active sessions.

## 2. Non-goals

- **Multiple simultaneous channels within the same guild.** Explicitly dropped per user
  decision - a guild may have at most one active session at a time. (A single bot account
  can only hold one voice connection per guild; supporting >1 concurrent channel per guild
  would require a pool of multiple bot tokens, which was considered and rejected as
  unnecessary complexity for now.)
- **Distributed/multi-process scaling** (Redis pub-sub, multiple gateway or bot nodes).
  Already tracked as a future phase in `docs/design/system-design.md`. This design keeps
  all cross-cutting state behind one module (`sessionRegistry.js`, Section 4) so that
  future work is a reimplementation of that module, not a rearchitecture - but it is not
  built now.
- **Cloudflare Tunnel / public exposure** - covered by the separate, already-approved
  `2026-07-06-cloudflare-tunnel-exposure-design.md`.
- Changing the OAuth flow or session-token model in `auth.js` - both are already
  guild-agnostic (a session token maps only to a Discord user ID), so nothing there needs
  to change.

## 3. Key architectural decisions

### 3.1 Continuous, connection-less channel authorization

A Discord user can only be connected to one voice channel at a time, platform-wide. This
lets authorization be a **live function recomputed on every broadcast** instead of a
subscribe/unsubscribe protocol:

- At WS connect, the existing auth gate resolves `token -> userId` exactly as today, and
  additionally requires the user currently be in a voice channel with an active session
  (else the socket is closed with the existing `4001 'not in voice channel'` code - same
  behavior as today, now guild-agnostic).
- Every outgoing message for a given guild's session is delivered only to connected
  clients whose *current* live voice channel (read straight from the bot's Discord
  gateway cache, no extra API calls) resolves to that guild. This is recomputed per
  message, not cached at connect time.
- Consequence: no subscribe messages, no stale scope, no reconnect-on-channel-switch. If
  a viewer leaves their channel mid-session, the very next broadcast simply stops
  matching for them - enforcement is a continuous invariant. If they move into a
  *different* guild's active session channel, they start receiving that one
  automatically, with no reconnect.
- If a connected viewer ends up in no active session at all (left voice entirely), they
  simply stop receiving messages - the socket is not proactively closed or notified. This
  matches today's behavior (a departed viewer already just stops appearing in roster
  updates) and avoids adding a new client-facing signal that wasn't asked for.

### 3.2 One active session per guild, single shared bot

The bot remains one Discord application/token, invited to as many guilds as want it -
completely normal multi-guild bot behavior (holding independent voice connections in
different guilds at once is how any music bot works). Within a single guild,
`@discordjs/voice`'s `getVoiceConnection(guildId)` already only ever holds one connection
per guild, which maps directly onto "one active session per guild":

- `/disco join` in a guild that already has an active session replies with an ephemeral
  error naming the in-progress channel, and does not start a second session.
- `/disco leave` (or the existing owner-leaves-channel auto-stop) is the only way to free
  up a guild for a new session.

### 3.3 Global concurrency cap

New `MAX_ACTIVE_SESSIONS` env var (default `5`). `/disco join` checks the current active
session count across *all* guilds before starting a new one, replying with an ephemeral
"at capacity" error if the cap is reached. This is a global cap independent of per-guild
limits, existing purely for Deepgram cost control.

## 4. New module: `sessionRegistry.js`

Pure in-memory bookkeeping, no `discord.js` dependency (kept swappable per Section 2's
non-goal on future distributed scaling):

```js
// guildId -> { channelId, ownerId, roster, voiceStateListener }
const sessions = new Map();

export function createSession(guildId, { channelId, ownerId, voiceStateListener }) { ... }
export function endSession(guildId) { ... } // returns the removed entry, or undefined
export function getSession(guildId) { ... } // { channelId, ownerId, roster } | undefined
export function setRoster(guildId, roster) { ... }
export function activeSessionCount() { ... }
```

`bot.js` calls into this instead of holding `trackedChannel`/`roster`/`voiceStateListener`
as its own module-level globals.

## 5. `bot.js` changes

- Remove `DISCORD_SERVER_ID` and every reference to it (`ClientReady` member-cache
  warm-up, `getUserProfile`, slash-command registration).
- Remove `trackedChannel` / `roster` / `voiceStateListener` globals - replaced by
  `sessionRegistry` calls.
- Remove `isUserInTrackedChannel`; replace with `getLiveSessionForUser(userId)`, which
  scans `client.guilds.cache` for a guild with a cached voice state matching `userId` and
  returns `{ guildId, channelId } | null`. This is the single source of truth both the
  gateway's connect-time gate and its per-broadcast filtering use (Section 3.1).
- `getUserProfile(userId)`: search guilds the bot shares with the user for a member
  record; prefer the guild returned by `getLiveSessionForUser(userId)` if present
  (matches the user's actual current context), otherwise fall back to the first shared
  guild found. `inTrackedChannel` becomes `!!getLiveSessionForUser(userId)`.
- Member-cache warm-up moves from a single eager fetch on `ClientReady` to a lazy
  per-guild fetch (fetch that guild's members once, the first time a session starts in it
  or the first time its members are needed) - avoids an eager full-member fetch for every
  invited guild regardless of whether it's ever used.
- `handleCaptionsStart`: before joining, check `sessionRegistry.getSession(guildId)`
  (reject with "already active in #channel" if present) and
  `sessionRegistry.activeSessionCount() >= MAX_ACTIVE_SESSIONS` (reject with "at
  capacity" if so). On success, call `sessionRegistry.createSession(...)` instead of
  setting `trackedChannel`.
- `stopCaptions(guildId)`: read the session from the registry to detach its
  `voiceStateListener`, then `sessionRegistry.endSession(guildId)`.
- All broadcasts (`roster`, `speaking`, `transcript`) gain `guildId` and `channelId`
  fields and go through the gateway's new `broadcastToSession(guildId, payload)`
  (Section 6) instead of the current global `broadcast(payload)`.
- Slash-command registration moves from
  `Routes.applicationGuildCommands(appId, DISCORD_SERVER_ID)` to
  `Routes.applicationCommands(appId)` (global commands), so any inviting guild gets the
  command. **Migration note:** global command registration can take up to ~1hr to
  propagate after first deploy (one-time, not per-restart); the old guild-scoped
  registration in the original test guild should be cleared once the global registration
  is confirmed live, to avoid duplicate `/disco` entries there.

## 6. `gateway.js` changes

- `gatewayClients`: `Set<ws>` becomes `Map<ws, userId>`, so each connection's identity is
  available for live re-evaluation on every broadcast.
- `createAuthGate`: on successful auth, store `(ws, userId)` in the map; the initial
  snapshot sent on connect becomes the roster for the user's *current* live session
  (via `getLiveSessionForUser` + `sessionRegistry.getSession`), not a single global
  roster.
- `broadcast(payload)` -> `broadcastToSession(guildId, payload)`: iterates
  `gatewayClients`, resolves each client's live session via `getLiveSessionForUser`, and
  delivers only when `liveSession?.guildId === guildId` and the socket is `OPEN`.

## 7. Client compatibility

No client code changes are required. `wsClient.js` already destructures only the fields
it uses (`members`, `speakerId`, `isSpeaking`) or passes the whole `transcript` message
through opaquely (`wsClient.js:33`) - adding `guildId`/`channelId` fields is purely
additive and ignored by existing handlers.

## 8. Config changes

`.env.example`:
- Remove `DISCORD_SERVER_ID` (no longer used - the bot now operates across every guild
  it's invited to).
- Add `MAX_ACTIVE_SESSIONS` (optional, default `5` if unset).

## 9. Testing scope

- **`sessionRegistry.js` (new):** unit tests for create/end/get/count, and for the
  "already active" and "at capacity" rejection conditions, as pure functions with no
  Discord dependency.
- **`gateway.js`:** extend `gateway.test.js` for the `Map<ws, userId>` change and
  `broadcastToSession` scoping - specifically, a test that two concurrent guild sessions
  stay isolated (a client live-scoped to guild A never receives a broadcast scoped to
  guild B).
- **`bot.js`:** remains manually verified only (thin `discord.js` wrapper, no existing
  unit tests), consistent with current precedent.
- **Manual verification** (via the `run` skill, using two test guilds): start sessions in
  both concurrently and confirm each client only ever sees its own guild's
  transcripts/roster; confirm the "already active" and "at capacity" errors; confirm a
  viewer who leaves their channel stops receiving updates; confirm the profile header
  still resolves correctly for a user in a guild other than the first one the bot joined.

## 10. Repository structure changes

**Add:**
- `sessionRegistry.js`
- `sessionRegistry.test.js`

**Modify:**
- `bot.js` - see Section 5.
- `gateway.js` - see Section 6.
- `gateway.test.js` - new/updated tests for scoped broadcast.
- `.env.example` - see Section 8.
