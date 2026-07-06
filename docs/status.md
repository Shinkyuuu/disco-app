It 

# Project Status-=

Tracking progress against [`development-plan.md`](development-plan.md) §3 (Development Parts).

## Part 0 - Bot skeleton - ✅ Done

Bot logs in and comes online in the test server. `/ping` slash command replies "Pong!".

## Part 1 - Join voice + raw capture - ✅ Done

`/record` joins the caller's voice channel, subscribes to the first speaker's
per-user Opus stream, decodes it (48kHz stereo PCM via `prism-media` +
`opusscript`), and writes it to `recordings/<userId>-<timestamp>.wav`.
Verified: playback was the user's voice, correctly decoded, no static.

*(Superseded by Part 3 - `/record` no longer stops after one speaker/file; see below.)*

## Part 2 - STT spike (offline, batch) - ✅ Done

`transcribe.js` (`npm run transcribe [path]`) sends a `.wav` file to Deepgram's
batch endpoint and prints the transcript. Defaults to the most recently
modified file in `recordings/` if no path is given.
Verified: transcript text matched what was said (API key/account confirmed working).

## Part 3 - Live streaming pipeline - ✅ Done

`/record` now stays open indefinitely: every time a new speaker starts talking,
a fresh per-user Deepgram WebSocket stream opens (`encoding=linear16&sample_rate=48000&channels=2&endpointing=300&model=nova-3`),
closing automatically after ~1s of silence. Transcripts print to console tagged
with the speaker's Discord user ID. `/leave` disconnects and tears down all
active streams for that guild.

Root-caused and fixed a bug (not just an accuracy tuning issue): raising
`endpointing` to 300ms meant fast/continuous speech often never hit Deepgram's
internal silence threshold *while audio was still streaming*, and the code then
abruptly closed the WebSocket the moment Discord's own silence timeout fired -
discarding the still-pending, un-finalized transcript. Fixed by sending
Deepgram's `CloseStream` control message (instead of a raw socket close) so it
finalizes and returns the last transcript before the connection closes. See
[`deepgram-streaming-params.md`](deepgram-streaming-params.md) for the tunable
params. Verified: live `final` transcripts now appear reliably, including on
fast/mumbled speech.

The temporary debug `.wav` capture used to diagnose this has been removed from `index.js`.

Also pinned `model=nova-3` explicitly (previously unset - Deepgram's own docs
disagree on what that defaults to, and `nova-3` is their most accurate
general-purpose model, relevant to conversational/slang speech).

## Part 4 - WebSocket gateway - ✅ Done

A `ws` `WebSocketServer` listens on port `3000` (override with `PORT` env var),
started alongside the bot. Every Deepgram transcript event (interim or final)
broadcasts as JSON - `{ speakerId, text, isFinal }` - to all connected clients.
Verified: a test client connects successfully; live broadcast confirmed while
speaking in the voice channel.

## Part 5 - Bare overlay client - ✅ Done

`overlay.html` is a standalone page (no server needed, opened directly as a
file) that connects to `ws://localhost:3000` and appends each incoming
transcript event as a raw text line, tagged with the speaker's raw Discord user
ID - no styling or name/avatar attribution yet. Verified: text appeared live
in the browser while speaking.

## Part 6 - Speaker attribution - ✅ Done

`resolveSpeaker()` looks up the speaking user's guild member (cache first,
REST fetch as fallback - requires the "Server Members Intent" enabled in
Part 0 setup) and returns their display name + avatar URL. Every broadcast
event now carries `username`/`avatarURL` alongside `speakerId`/`text`/`isFinal`,
and `overlay.html` renders each caption line with an avatar image and name.
Verified: two people talking showed two distinctly labeled lines.

## Part 7 - UX polish - ✅ Done

`overlay.html` now keeps one persistent caption row per speaker (keyed by
`speakerId`) instead of appending a new line per event. Interim text updates
the row in place (dimmed/italic), then final text replaces it in place - no
new DOM elements, no flicker/jump. After 3 seconds without a new event for a
speaker, their row fades out (CSS opacity transition) and is removed.
Overlapping speakers naturally render as separate concurrent rows. Verified:
a back-and-forth conversation reads cleanly, including overlapping speech.

## Part 8 - Plug-and-play packaging - ✅ Done

`/record`/`/leave` renamed to `/captions start`/`/captions stop` (subcommands
of a single `captions` command), matching the plan's intended public command
shape. `overlay.html` is now served over plain HTTP by the same Node process
(a minimal `http` server, no new dependency), with the `WebSocketServer`
attached to that same HTTP server - one port (`3000` by default) for both the
page and the gateway. `/captions start` replies with the overlay URL directly.
Added a `README.md` covering account setup, `.env` vars, and usage.
Verified: bot starts cleanly, `http://localhost:3000` serves the overlay page,
`/captions start` returns a working link while running the bot locally.

## Part 9 - Not started

- Production hosting on EC2

## Files in the repo so far

| File                                  | Purpose                                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `index.js`                          | The bot: login,`/ping`, `/captions start`/`stop`, live per-speaker Deepgram streaming, HTTP+WebSocket gateway    |
| `overlay.html`                      | Overlay client - served over HTTP, connects to the gateway, renders attributed live captions with UX polish            |
| `README.md`                         | Setup and usage instructions                                                                                          |
| `transcribe.js`                     | Standalone Part 2 batch-transcription spike script                                                                     |
| `package.json`                      | ESM Node project;`discord.js`, `@discordjs/voice`, `prism-media`, `opusscript`, `wav`, `ws`, `dotenv`    |
| `.env` (gitignored)                 | `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_SERVER_ID`, `DEEPGRAM_API_KEY` |
| `recordings/` (gitignored)          | `.wav` files from Part 1's `/record` capture                                                                       |
| `docs/design/system-design.md`      | Architecture/design doc                                                                                                |
| `docs/development-plan.md`          | The ordered build plan this status doc tracks against                                                                  |
| `docs/deepgram-streaming-params.md` | Reference for tunable Deepgram streaming query params                                                                  |

## Known non-blocking issue

`npm install` reports 4 vulnerabilities (3 moderate, 1 high) in `undici`, a
transitive dependency pinned by `discord.js@14.26.4` itself (already the latest
version - no newer release fixes this yet, and `npm audit fix --force` would
downgrade to the much older discord.js 13.x). Low risk in this context since
undici here only talks to Discord's own API/gateway, not untrusted servers.
Revisit when discord.js ships an undici bump.
