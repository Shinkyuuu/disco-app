# Discord Live Captioning - Development Plan

This is the practical "how to begin" companion to the architecture design doc
discussed earlier. It covers: accounts/keys, local tooling, the ordered
development parts, and how/when to set up a production server.

## 1. Accounts & Keys

| # | What | Where | Notes |
|---|------|-------|-------|
| 1 | Discord application + bot | [discord.com/developers/applications](https://discord.com/developers/applications) → New Application → Bot tab | Copy the **bot token** into `.env`, never commit it. |
| 2 | Bot intents | Same page, "Privileged Gateway Intents" | Enable **Server Members Intent** from the start - `VOICE_STATE_UPDATE` payloads only carry `user_id`/`channel_id`, no username or avatar, so resolving speaker attribution (Part 6) requires a member cache/fetch, which needs this intent. |
| 3 | Bot invite/permissions | OAuth2 → URL Generator | Scopes: `bot`, `applications.commands`. Permissions: **Connect**, **Speak**, **View Channel**. |
| 4 | Test server | Your own Discord server (admin rights) | Needs a voice channel to test in. |
| 5 | STT provider account | [deepgram.com](https://deepgram.com) | Sign up, generate an API key. Free tier covers the entire MVP phase. |

## 2. Local Development Tooling

- **Node.js LTS** (v20+) + npm - runtime for `discord.js` / `@discordjs/voice`.
- **Opus codec library** - `opusscript` (pure JS, no native build step). `@discordjs/opus` is faster but needs native build tools; skip it until you actually need the CPU headroom. Note: `opusscript` hasn't been published since October 2023 - still functional but unmaintained, so keep an eye on it if decode issues show up.
- **Encryption library - check before installing anything.** Run:
  ```
  node -e "console.log(require('node:crypto').getCiphers().includes('aes-256-gcm'))"
  ```
  If this prints `true` (it will on most modern Node/Linux/Windows setups), `@discordjs/voice` needs no extra encryption package. Only add `libsodium-wrappers` as a fallback if it prints `false`.
- **`dotenv`** - loads `DISCORD_TOKEN` and `DEEPGRAM_API_KEY` from `.env`. Add `.env` to `.gitignore` immediately, before the first commit that touches secrets.
- **`wav` (npm package, optional)** - wraps raw PCM in a WAV header for debugging captured audio; not part of the runtime pipeline.

## 3. Development Parts (all run locally - no server required yet)

Each part produces something you can run and verify before moving on.

**Part 0 - Bot skeleton**
Bot logs in and comes online in your test server; add a trivial slash command (e.g. `/ping`) that replies.
*Verify: command responds in Discord.*

**Part 1 - Join voice + raw capture**
Bot joins a voice channel on command and captures one speaking user's audio to a local `.wav` file via the per-user receive stream (`@discordjs/voice` demuxes audio per speaker automatically - never touch the mixed channel output). Output is 48kHz **stereo** PCM after Opus decode.
*Verify: play back the `.wav` file - it's your voice, correctly decoded, no static/garbling.*

**Part 2 - STT spike (offline, batch)**
Send a captured `.wav` file to Deepgram's batch endpoint (`POST https://api.deepgram.com/v1/listen`, header `Authorization: Token <API_KEY>`), print the transcript.
*Verify: transcript text roughly matches what was said. This validates the API key and account before touching live streaming.*

**Part 3 - Live streaming pipeline**
Replace the file-write step with a live Deepgram streaming connection. Open the WebSocket with explicit format params matching Discord's decoded audio: `encoding=linear16&sample_rate=48000&channels=2` (or downmix to mono first to halve bandwidth/cost - worth doing here). Print interim/final transcripts to console tagged with the speaker's Discord user ID.
*Verify: speak in the voice channel, see transcripts in your terminal within ~1 second.*

**Part 4 - WebSocket gateway**
Wrap the process with a `ws`/Socket.IO server; broadcast each transcript event (speaker ID, text, interim/final flag) to connected clients.
*Verify: connect with `wscat` or browser devtools and see events arrive live.*

**Part 5 - Bare overlay client**
A single HTML page that connects to the WebSocket and renders raw transcript text (no styling/attribution yet).
*Verify: open the page in a browser while talking - text appears live.*

**Part 6 - Speaker attribution**
Resolve Discord user ID → username + avatar URL and attach it to each transcript event; overlay renders name + avatar per caption line.
*Verify: two people talk in the channel, overlay shows two distinct labeled caption lines.*

**Part 7 - UX polish**
Smooth interim→final text replacement (no flicker/jump), fade caption lines out after a few seconds of silence, handle overlapping speakers as separate concurrent lines.
*Verify: a normal back-and-forth conversation looks clean and readable, not jarring.*

**Part 8 - Plug-and-play packaging**
`/captions start` slash command spins up a session and returns the overlay URL; `/captions stop` tears it down. Write a short README covering setup.
*Verify: someone with no context can invite the bot, run one command, and get a working overlay link - while you're still running the bot from your own machine.*

## 4. Part 9 - Production Hosting (AWS EC2)

Do this once Parts 0–8 work locally and you want the bot always-on and a stable public URL, independent of your laptop being on.

**4.1 Launch the instance**
- AMI: **Ubuntu 24.04 LTS, arm64**
- Instance type: **`t4g.small`** (2 vCPU burstable, 2GB RAM - comfortable headroom for the bot plus several concurrent STT streams). `t4g.micro` (1GB) works for solo testing but gets tight once a few users are captioned at once.
- Storage: default 8–16GB gp3 is enough.
- Graviton (`t4g`) is ~20–40% cheaper than equivalent `t3` (x86) instances for the same burstable performance, and Node.js plus the pure-JS packages this project uses (`opusscript`, etc.) run on ARM with no code changes.

**4.2 Networking**
- Allocate an **Elastic IP** and associate it with the instance, so the address doesn't change on reboot. Note: since Feb 2024, AWS bills ~$0.005/hour (~$3.60/month) for any public IPv4 address, attached or not - this is no longer free.
- Security group inbound rules:
  - `22` (SSH) - restrict source to your own IP, not `0.0.0.0/0`. Consider **AWS Systems Manager Session Manager** instead of SSH entirely - no inbound port, no key file, IAM-based auth.
  - `80` (HTTP) - required for Let's Encrypt certificate issuance.
  - `443` (HTTPS/WSS) - public.
  - Do **not** expose the raw Node port (e.g. `3000`) publicly - bind it to `localhost` and reverse-proxy it.
- Create an SSH key pair on launch; `chmod 400` the downloaded `.pem` file before using it.
- Enforce **IMDSv2** on the instance (Instance Metadata Options → require tokens) to block SSRF-based credential theft.

**4.3 DNS**
- Point a subdomain (e.g. `captions.yourdomain.com`) at the Elastic IP via an A record (Route 53 or your existing registrar). A real hostname is required both for Let's Encrypt and because browsers block `wss://` connections from an `https://` page unless the certificate is valid for that hostname.

**4.4 Server setup (after SSH-ing in)**
1. Install Node.js LTS (NodeSource setup script, or `nvm`).
2. Install **Caddy** as a reverse proxy - it handles HTTPS/Let's Encrypt automatically with a ~5-line Caddyfile:
   ```
   captions.yourdomain.com {
       reverse_proxy localhost:3000
   }
   ```
   This gives you `wss://captions.yourdomain.com` proxied straight to the local Node process, no manual certificate management.
3. Clone the repo, `npm install`, create `.env` on the server directly (via `scp` or pasted over SSH) - never bake secrets into the AMI or commit them.
4. Install `pm2` globally; `pm2 start` the bot process; run `pm2 startup` + `pm2 save` so it survives instance reboots.

**4.5 Verify**
Visit `https://captions.yourdomain.com` - the overlay loads over HTTPS, the WebSocket connects as `wss://`, and a caption appears when you talk in the test voice channel.

**Rough monthly cost:** `t4g.small` ≈ $12, Elastic IP ≈ $3.60 (billed per public IPv4 address since Feb 2024), domain ≈ $10–15/year.

**Note:** since "ease of use" is priority #2 for this whole product, a PaaS host (Railway, Fly.io, Render) would remove nearly all of §4.1–4.4 - push-to-deploy, automatic HTTPS, no security groups or SSH - at a somewhat higher $/compute. Worth reconsidering once you're past the prototype and deciding on a permanent home, but EC2 is a reasonable, cheaper choice if you're comfortable with the ops overhead above.

## 5. Sequencing Summary

```
Accounts/keys (§1) → Local tooling (§2) → Parts 0-8, all local (§3) → Part 9, EC2 deploy (§4)
```

Parts 0–3 (audio capture → live STT) are the highest-risk, least-glamorous work - they answer "does the core pipeline actually work at acceptable latency" before any UI exists. Do not skip ahead to the overlay (Parts 5–7) before Part 3 is verified end-to-end.
