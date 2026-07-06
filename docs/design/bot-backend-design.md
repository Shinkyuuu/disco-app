# Bot & Backend - As-Built Design

This is a current-state architecture reference for the Discord bot and
backend, as implemented through `development-plan.md` Parts 0–8. Unlike
[`electron-client-design.md`](electron-client-design.md), this isn't a
forward-looking proposal - it documents what's actually running today, plus
where the Part 10/11 auth and protocol work from that design plugs in. See
[`system-design.md`](system-design.md) for the original high-level rationale
and [`../status.md`](../status.md) for the chronological build history
(including bugs found and fixed along the way).

## 1. Role in the system

This is the "Bot/backend" + "Realtime Gateway" layers from
`system-design.md` §1, combined into one Node.js process (deliberately -
splitting them is Phase 3 territory, not worth it until concurrency data
demands it).

## 2. Process & module structure

**Today:** everything lives in one file, `index.js` (~215 lines): Discord
client setup, voice capture, STT streaming, attribution, and the HTTP/WS
gateway.

**Planned (Part 10 of `electron-client-design.md`):** split into
`bot.js` (Discord client, voice capture, STT - this file's content largely
unchanged), `gateway.js` (HTTP server, WebSocket server, broadcast, the
new WS-connect authorization check), and `auth.js` (OAuth login/callback,
token issuance/verification), with `index.js` reduced to wiring them
together. That split hasn't happened yet as of this writing.

## 3. Discord bot layer

**Client intents:** `Guilds` (baseline, required for slash commands),
`GuildVoiceStates` (required to join voice channels and read who's in
them), `GuildMembers` (required to resolve display name/avatar for
attribution - this is why "Server Members Intent" had to be enabled in the
Discord Developer Portal during initial setup).

**Commands:**
- `/ping` - trivial liveness check from Part 0.
- `/captions start` - joins the caller's current voice channel, replies with the overlay URL, and registers a `speaking` listener that starts a transcription pipeline (§4) for each user the moment they start talking.
- `/captions stop` - tears down all active per-speaker pipelines for the guild and disconnects from the voice channel.

Originally these were separate `/record` and `/leave` commands from early
development; renamed to `/captions start`/`stop` in Part 8 to match the
plan's intended public command shape.

## 4. Per-speaker STT pipeline

**Why per-speaker, not one mixed stream:** Discord's voice receive API
already demuxes audio per SSRC (per speaker) - this is what makes clean
attribution possible without doing real-time diarization on a single mixed
stream, which isn't reliable enough for this product (`system-design.md`
§6).

**Lifecycle**, per speaking-start event:
1. `activeStreams` (keyed `${guildId}:${userId}`) guards against opening a second pipeline for a user who's already being transcribed. The key is reserved (`set(key, null)`) *before* the async attribution lookup, to close a race where the same user could trigger two pipelines if they start a new speech burst while the first one's attribution lookup is still in flight.
2. `resolveSpeaker()` looks up the guild member (cache first, REST `fetch` as fallback) for display name + avatar.
3. **Cancellation check:** immediately after the attribution lookup resolves, the code re-checks that the key is still reserved. If `/captions stop` ran while the lookup was in flight, the reservation was removed and pipeline setup aborts here - otherwise it would open an Opus subscription and a Deepgram socket against a voice connection that's already being torn down.
4. `connection.receiver.subscribe(userId, { end: { behavior: AfterSilence, duration: 1000 } })` opens the per-user Opus stream, closing automatically 1 second after they stop talking.
5. The Opus stream pipes through `prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 })` - 48kHz stereo, matching Discord's decoded audio format and Deepgram's native input format (no downsampling needed).
6. A Deepgram streaming WebSocket opens in parallel. PCM chunks arriving before the socket finishes connecting are buffered and flushed on `open`, rather than dropped.
7. Deepgram's `message` events are filtered for a non-empty transcript, logged to console, and broadcast (§6).
8. When the Opus stream ends (1s of Discord-side silence), the code sends Deepgram's `{"type": "CloseStream"}` control message rather than closing the raw socket. **This is a fixed bug, not just a tuning choice** - see below.
9. **Cleanup by identity:** the `activeStreams` entry created in step 4 is deleted (on the Deepgram socket's `error` or `close` event) only if it's still the *current* entry for that key - a plain key-based delete would let a slow-closing stale pipeline wipe out a newer pipeline's live entry for the same user (e.g. if they stop and start speaking again quickly). The `error` handler also deletes the entry (it used to only log), so a Deepgram-side error can't permanently lock a user out of captions for the rest of the session - without it, the key would stay reserved forever since nothing else clears it.

**Why `endpointing=300` and the `CloseStream` fix (see `deepgram-streaming-params.md` for the full parameter reference):**
Deepgram's own internal silence threshold (`endpointing`, default 10ms) is
separate from Discord's 1000ms silence-based stream teardown. At the
aggressive default, Deepgram would finalize mid-sentence on tiny natural
pauses - worse accuracy, but it meant a `final` transcript always escaped
*before* the code closed the socket. Raising `endpointing` to 300ms fixed
the fragmentation, but exposed a real bug: continuous fast speech could
complete without ever tripping Deepgram's internal threshold while audio was
still streaming, and abruptly closing the socket at that point discarded
Deepgram's still-pending, un-finalized transcript entirely. Fix: send
`CloseStream` and let Deepgram finalize and respond before the connection
closes, instead of a raw close.

**Why `model=nova-3`:** previously unset; Deepgram's own docs disagree on
what that defaults to. Pinned explicitly as their most accurate
general-purpose model, relevant to conversational/slang speech.

## 5. Speaker attribution

`resolveSpeaker(guildId, userId)` returns `{ username, avatarURL }` from the
guild member's `displayName` and `displayAvatarURL()` - guild-specific
(nickname/server avatar), not the global Discord username, since that's
closer to what people in that server actually recognize each other by.

## 6. WebSocket gateway + HTTP server

One Node `http.Server` serves both the overlay page (currently
`overlay.html`, static, read once at startup) and, via the same server
instance, the `ws` `WebSocketServer` - one port (`3000` by default,
override with `PORT`) for both, so a future reverse proxy (Part 9, EC2)
only needs to forward one port.

**Broadcast today:** every Deepgram transcript (interim or final) is
JSON-broadcast to every connected client, unfiltered:
`{ speakerId, username, avatarURL, text, isFinal }`. There's no `type`
discriminator yet, and no authorization on who can connect.

**Planned (Part 10/11):** per `electron-client-design.md` §3, this becomes
one of three typed messages (`roster`, `speaking`, `transcript`), and the WS
upgrade itself gets gated on a token proving the connecting user is
currently in the voice channel being captioned. Until that lands, **anyone
who can reach the port can see all captions** - acceptable for local-only
development, not for anything hosted.

The connection stays plaintext `ws://` even after auth lands (see
`electron-client-design.md` §3.4) - fine while the bot and client are on the
same machine/LAN with no untrusted network path, but `wss://` becomes
required, not optional, once EC2 hosting (`electron-client-design.md` §8
open item) is in play; the reverse proxy already planned for that
(`development-plan.md` §4.4, Caddy) terminates TLS for free, so this needs a
client default-scheme change, not new backend work.

## 7. Environment variables

| Var | Used by | Notes |
|---|---|---|
| `DISCORD_APPLICATION_ID` | command registration | |
| `DISCORD_BOT_TOKEN` | bot login | |
| `DISCORD_SERVER_ID` | command registration | guild-scoped commands for instant propagation during dev |
| `DEEPGRAM_API_KEY` | STT | |
| `PORT` | HTTP/WS server | optional, defaults to `3000` |
| `DISCORD_PUBLIC_KEY` | *(unused)* | present in `.env` from initial setup; only needed for HTTP-based interaction verification, which this bot doesn't use (it uses the gateway/WebSocket connection via `discord.js`'s `Client`) |
| `DISCORD_CLIENT_SECRET` | *(planned, Part 10)* | OAuth code exchange, per `electron-client-design.md` |

## 8. Known limitations

- **No access control** on who can connect to the WebSocket gateway (see §6) - the reason `electron-client-design.md` exists.
- **No crash/reconnect story.** If the bot process dies mid-session, there's no automatic re-join - `/captions start` has to be re-run by hand, and any open Electron clients just see their WebSocket drop. Given "ease of use" is priority #2 for this product, this is more product-relevant than it might look; worth a supervisor process (`pm2`, already planned for EC2 hosting per `development-plan.md` §4.4) plus, eventually, auto-rejoin-on-restart logic.
- **Single global session** - one guild, one voice channel, at a time. No multi-guild/multi-channel support.
- **Local-only hosting** - `development-plan.md` §4 (EC2 deployment) hasn't been done.
- **`npm audit` reports 4 vulnerabilities** (3 moderate, 1 high) in `undici`, a transitive dependency pinned by `discord.js@14.26.4` itself. No newer discord.js release fixes it yet, and forcing an upgrade would downgrade to discord.js 13.x. Low risk currently since undici here only talks to Discord's own API/gateway, not untrusted servers - revisit when discord.js ships an undici bump.
