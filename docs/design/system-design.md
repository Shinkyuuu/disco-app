# Discord Live Captioning - System Design

## 1. Architecture Overview

```
Discord Voice Channel
        │  (per-speaker Opus/RTP, already demuxed by SSRC)
        ▼
┌─────────────────┐
│  Discord Bot     │  joins VC, receives per-user audio streams,
│  (voice capture) │  gates capture on speaking-start/stop events
└────────┬─────────┘
         │ Opus → PCM (prism-media), small chunks (~20–100ms)
         ▼
┌─────────────────┐
│ STT Streaming    │  one streaming connection per *currently speaking*
│ Client (per user)│  user, opened on speech-start, closed on silence
└────────┬─────────┘
         │ interim + final transcript events
         ▼
┌─────────────────┐
│ Session/Backend  │  maps Discord user ID → username/avatar,
│                  │  tags each transcript with speaker + session
└────────┬─────────┘
         │
         ▼
┌─────────────────┐
│ Realtime Gateway │  WebSocket fan-out to all overlay clients
│                  │  subscribed to this channel's session
└────────┬─────────┘
         │
         ▼
┌─────────────────┐
│ Electron Overlay │  transparent always-on-top window, renders
│ (desktop app)    │  per-speaker caption bubbles, click-through
└─────────────────┘
```

For an MVP, the bot, session/backend, and WebSocket gateway live in **one process** - splitting them into separate services buys nothing until you have real concurrency data showing the single process is the bottleneck.

The Electron overlay replaces any browser tab or OBS Browser Source. Users install it once, run it alongside Discord, and connect it to an active captioning session via a URL/token produced by the bot.

---

## 2. Electron Overlay - Design Details

**Window behaviour**

- Transparent, frameless, always-on-top window (`transparent: true`, `frame: false`, `alwaysOnTop: true`).
- Click-through by default: `setIgnoreMouseEvents(true, { forward: true })` so normal Discord interaction is unaffected. Mouse-over the captions area disables click-through temporarily so users can interact (e.g. drag to reposition).
- Captions render in a fixed region (bottom-center by default). Position and opacity are configurable and persisted between sessions.
- System tray icon as the primary control surface - connect/disconnect, show/hide, quit.

**Session connection**

- The bot issues a session token via a slash command (e.g. `/captions start`) and posts a `discord-echo://session/<token>` deep link into the text channel.
- Clicking the link on a machine with the overlay installed opens it and auto-connects to that session's WebSocket endpoint.
- Alternatively, users can paste the token manually in the overlay's minimal settings screen.

**Ease of install**

- Packaged as a signed installer (NSIS on Windows, DMG on macOS) via `electron-builder`.
- Auto-updater via `electron-updater` so users never need to manually update.
- Launch on login optional (configurable in tray).

---

## 3. Development Phases

**Phase 0 - Spike (validate the riskiest unknown first)**
Join a VC, capture one user's audio, decode it, round-trip it through the chosen STT provider, and measure actual speech-onset-to-transcript latency. Everything else depends on this number being real, not assumed.

**Phase 1 - MVP**
Single guild, single voice channel. Bot captures each speaker's audio individually (Discord already demuxes per-speaker streams). Open one STT stream per user only while they're speaking. Push interim + final transcripts over WebSocket. The Electron overlay connects via a session token pasted in, displays caption bubbles (username + avatar) keyed to Discord user ID, transparent always-on-top window. No multi-guild, no auto-updater, no deep links yet - those ship after the core loop is proven.

**Phase 2 - Iteration / hardening**
Multi-channel and multi-guild support within one bot process. Add the `/captions start` slash command that mints a session token and posts the deep link. Implement the `discord-echo://` protocol handler in the Electron app for one-click connect. Smooth interim-to-final caption transitions (no flicker). Reconnect/resilience for STT and WebSocket drops. Silence-timeout auto-teardown of idle STT streams. Sign and package the installer with auto-updater.

**Phase 3 - Scaling**
Only once concurrency data justifies it: split voice-capture (bot) from STT-orchestration/fanout (backend) via a message broker (Redis pub/sub or NATS) so bot shard count and backend worker count scale independently. Multiple WebSocket gateway nodes behind pub/sub-backed fanout. Per-guild settings persistence (Postgres/SQLite). STT provider fallback.

---

## 4. Key Technical Challenges

**Latency.** Controllable levers: stream small audio chunks continuously (never buffer whole utterances before sending to STT); keep per-speaker STT streams parallel and independent; keep the backend/gateway network-close to the STT provider's ingest region. Discord voice packets arrive every 20ms - avoid adding buffering hops.

**Audio handling.** Discord's voice receive API gives separate Opus/RTP streams per speaker (per SSRC) - this is what makes clean attribution possible without audio-source separation. Gate STT streams on the library's speaking-start/stop events, not custom VAD. Opus decoders handle minor packet loss via built-in error concealment. Deepgram accepts 48kHz stereo PCM directly, avoiding a downsample step.

**Multi-speaker attribution.** Maintain a live SSRC→Discord-user-ID map per session (from voice-library speaking events). Overlapping speech means multiple simultaneous STT streams - the overlay must render concurrent caption lines per speaker rather than merging them. Refresh username/avatar on voice-state updates.

**Cost vs. responsiveness.** Each actively-talking user is one billed STT connection. Opening a stream per speech-burst (not always-on) controls cost but adds ~100–300ms reconnect latency per utterance - an explicit tradeoff, not a bug to eliminate.

**Electron overlay rendering.** Transparent Electron windows on Windows occasionally flicker on resize or when the GPU compositor repaints. Use a fixed-size window and CSS-only caption transitions rather than layout changes to keep repaints minimal.

---

## 5. Suggested Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Bot / backend | Node.js + `discord.js` + `@discordjs/voice` | Mature per-user voice receive; `prism-media` Opus decode bundled |
| STT | Deepgram streaming | Low latency, native 48kHz support, good free tier; bake-off vs AssemblyAI real-time in Phase 0 before committing |
| Realtime gateway | `ws` or Socket.IO (same process as bot for MVP) | Socket.IO adds reconnect/room semantics worth having for "ease of use" priority |
| Client overlay | Electron + React (or Svelte) | Transparent always-on-top window, system tray, protocol handler, auto-updater via `electron-builder` + `electron-updater` |
| Installer | `electron-builder` | NSIS (Windows), DMG (macOS), auto-update out of the box |
| Scaling only | Redis, Postgres/SQLite | Pub/sub fanout, per-guild settings |

---

## 6. Design Tradeoffs

**Simplicity vs. scalability** - one Node.js process (bot + backend + WS server) for MVP is far simpler to build/deploy/debug. Splitting services buys horizontal scale but adds a message bus and cross-service latency; defer until data demands it.

**Latency vs. accuracy** - interim STT results appear fast but get revised as more audio arrives. Showing only finals is stable but adds a full utterance's worth of latency. Recommendation: render interim text immediately (visually dimmed), replace with final text in place - same pattern as YouTube/Meet captions.

**Per-speaker streams vs. one mixed stream** - per-speaker costs more STT connections but is the only way to get reliable real-time attribution and handle overlapping speech correctly. Real-time diarization on a single mixed stream isn't reliable enough for this product's core requirement.

**Always-on vs. on-demand STT connections** - on-demand (opened on speech-start, closed on silence) is the right default for sporadic talking patterns, at the cost of a small reconnect delay per utterance.

**Electron vs. web** - Electron enables a transparent system-level overlay and a one-click install that requires no browser configuration, matching the "plug and play" priority. The tradeoff is a larger distributable (~150MB) and OS-level signing requirements - on macOS, code signing plus notarization isn't just "smoother install," it's mandatory: an unsigned build is blocked by Gatekeeper and `electron-updater` won't function at all, so budget for an Apple Developer account (~$99/year) if macOS ships.

---

## 7. Guidelines for Staying Fast and Responsive

- Stream audio to STT in small continuous chunks - never buffer a full utterance before sending.
- Gate STT connections per-speaker on speaking-state, not session-wide always-on.
- Keep backend and WS gateway network-close to the STT provider's ingest endpoint.
- Render interim transcripts the instant they arrive; treat "final" as an in-place text replacement, not a new UI element, so captions don't jump or reflow.
- Skip intermediate hops (e.g., a message queue between STT result and WS push) until scaling actually requires them.
- Avoid Electron window resizes during active captioning - use CSS opacity/transform transitions only, which stay on the GPU compositor and don't trigger layout.
- Track end-to-end latency (speech onset → pixel-on-screen) as the north-star metric from Phase 0 onward, not component latencies in isolation.
