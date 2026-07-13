# Disco App

**Real-time, speaker-attributed live captions for Discord voice channels.**

Disco listens to a Discord voice channel and streams live, per-speaker captions to a customizable desktop overlay.

[![License: Apache 2.0](<https://img.shields.io/badge/License-Apache%202.0-blue.svg>)](LICENSE)
[![Node](<https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white>)](https://nodejs.org)
[![Electron](https://img.shields.io/badge/Electron-39-47848F?logo=electron&logoColor=white)](https://www.electronjs.org)

---

## Demo / Preview

WORK IN PROGRESS

## Overview

Disco is a **live-subtitle system for Discord voice channels**. Captions are provided per-speaker and can be viewed in a customizable overlay on your desktop.

The system has two halves:

- **A Discord bot + backend** (Node.js) that joins a voice channel, transcribes each speaker's audio independently in real time, and fans out caption events over WebSocket. Discord OAuth verifies user identity to make captions accessible ONLY to users in the discord channel being captioned.
- **A desktop client** (Electron + React) that logs in with Discord, connects to a session, and renders a live speaker strip and scrolling caption log.

## Quick Start

To run this project locally, you will need to create your own discord bot and backend. There are two things to set up: **the backend** (Discord bot + Deepgram Speech-to-Text + WebSocket gateway) and **the desktop client**.

### Prerequisites

| Requirement                                                       | Notes                                                            |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| [Node.js](https://nodejs.org) 20+                                  | Runtime for both the backend and the Electron client             |
| A Discord account with a server you admin                         | Needs a voice channel to test in                                 |
| [Discord application](https://discord.com/developers/applications) | Provides your bot token, application ID, and OAuth client secret |
| [Deepgram](https://console.deepgram.com) account                   | Free tier is enough for development                              |

### 1. Set up your Discord application

1. Create a new application at the [Discord Developer Portal](https://discord.com/developers/applications).
2. **Bot tab**: create a bot, copy its **token**, and enable the **Server Members Intent** and **Presence Intent**.
3. **OAuth2 tab**: copy the **Client ID** (this is your `DISCORD_APPLICATION_ID`) and **Client Secret**.
4. **OAuth2 -> Redirects**: add `http://localhost:3000/auth/callback` (this must exactly match the backend's `PUBLIC_BASE_URL`, which defaults to `http://localhost:3000` when unset).
5. **OAuth2 -> URL Generator**: scopes `bot` + `applications.commands`; bot permissions **Connect**, **Speak**, **View Channel**. Use the generated URL to invite your bot to your test server.

### 2. Run the backend

First fork the repository

```bash
git clone https://github.com/{YOUR_USERNAME}/disco-app.git
cd disco-app
npm install
```

Create a `.env` file in the repo root:

```bash
# Discord application, from step 1 above
DISCORD_APPLICATION_ID=
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_SECRET=

# Deepgram (speech-to-text)
DEEPGRAM_API_KEY=

# Required: signs session tokens. Can be generated with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Changing this later logs everyone out.
SESSION_SECRET=

# Optional - cap on simultaneous active `/disco join` sessions.(default: 5)
MAX_ACTIVE_SESSIONS=

# Optional - HTTP/WebSocket port (default: 3000)
PORT=
```

Then start it:

```bash
npm start
```

This starts the Discord bot and the HTTP/WebSocket gateway (default `http://localhost:3000`) in one process.

### 3. Run the desktop client

```bash
cd client
npm install
```

Create a `.env` file inside `client/`:

```bash
# Points the client at your local backend.
SERVER_ADDRESS=localhost:3000
```

Then start it in dev mode:

```bash
npm run dev
```

This launches the Electron **launcher** window.

### 4. Try it out

1. In your Discord server, join a voice channel and run **`/disco join`**.
2. In the Disco launcher window, click **Start Chat Window**. This opens your system browser for a one-time Discord login, then returns you to the app.
3. Talk in the voice channel and you should see your live captions appearing in the Disco overlay.
4. Run **`/disco leave`** in Discord to end the session.

## Features

- **Near real-time streaming captions**: audio is decoded and streamed to Deepgram continuously.
- **Per-speaker attribution**: Discord's voice API already demuxes audio per speaker, so each person gets their own transcription pipeline and their own caption line (no diarization guesswork), tagged with their server display name and avatar.
- **Overlapping speech handled correctly**: simultaneous speakers render as separate concurrent lines instead of a garbled merged transcript.
- **Discord OAuth login**: The client authenticates the viewer as a real Discord identity; the gateway only streams captions to sockets that prove the connected user is actually in the voice channel being captioned.
- **Multi-guild, concurrent sessions**: many servers can run independent `/disco join` sessions at once, capped by `MAX_ACTIVE_SESSIONS` for cost control.
- **Live roster + speaking indicators**: a speaker strip shows who's currently in the channel and animates in real time as they start/stop talking, independent of transcription latency.
- **Chat-style caption log**: each finalized utterance becomes its own line.
- **Configurable overlay**: Discord-avatar or custom-image speaker icons, adjustable chat appearance, a collapsible chat box, and a lockable click-through mode for overlaying on top of other windows/games.
- **Simple slash-command interface** — `/disco join`, `/disco leave`, `/disco ping`.

## Contributing

WORK IN PROGRESS

## Known Issues / Limitations

- **No continuous voice-channel re-verification**: Access is checked once, at WebSocket connect time. If a (non bot invoker) viewer leaves the tracked voice channel mid-session, their already-open client keeps receiving captions until it reconnects.
- **No crash/reconnect for the bot process**: If the bot restarts mid-session, `/disco join` must be re-run manually; connected clients just see their WebSocket drop.
- **Not verified to work on MacOS**: Needs to be ran on MacOS to verify functionality.
- **One active voice channel per guild at a time**: A server can't run two simultaneous `/disco join` sessions in different channels.

## License

Disco is licensed under the [Apache License 2.0](LICENSE).

In short: you're free to use, modify, and distribute this code (including commercially), as long as you retain the copyright and license notice and clearly document any changes you make to it. See the [`LICENSE`](LICENSE) file for the full text.

## Contact / Support

- **Bugs / feature requests:** [GitHub Issues](https://github.com/Shinkyuuu/disco-app/issues)
- **Maintainer:** [@Shinkyuuu](https://github.com/Shinkyuuu)
- **Email:** [codyspark.dev@gmail.com](mailto:codyspark.dev@gmail.com)
