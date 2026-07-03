# discord-echo

Live-captioning overlay for Discord voice channels: real-time speech-to-text,
attributed per speaker, shown in a browser overlay.

## Setup

1. **Create a Discord bot** at [discord.com/developers/applications](https://discord.com/developers/applications):
   - New Application → **Bot** tab → copy the bot token.
   - Under **Privileged Gateway Intents**, enable **Server Members Intent**.
   - **OAuth2 → URL Generator** → scopes `bot`, `applications.commands` → permissions **Connect**, **Speak**, **View Channel** → use the generated URL to invite the bot to your server.
2. **Get a Deepgram API key** at [deepgram.com](https://deepgram.com).
3. Create a `.env` file in the project root with:
   ```
   DISCORD_APPLICATION_ID=...
   DISCORD_BOT_TOKEN=...
   DISCORD_SERVER_ID=...
   DEEPGRAM_API_KEY=...
   ```
   (`DISCORD_SERVER_ID` is your test server's ID — enable Developer Mode in
   Discord's User Settings → Advanced, then right-click the server icon →
   Copy Server ID.)
4. Install dependencies and start the bot:
   ```
   npm install
   npm start
   ```

## Using it

In your Discord server:

- `/captions start` — bot joins your current voice channel and starts captioning. It replies with the overlay URL (`http://localhost:3000` by default).
- Open that URL in a browser to see live captions as people speak.
- `/captions stop` — bot stops captioning and leaves the voice channel.

The overlay URL only works while the bot is running on your own machine —
see `docs/development-plan.md` §4 for taking this to production hosting.
