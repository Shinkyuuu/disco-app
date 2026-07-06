# Deploying Disco with a Cloudflare Tunnel

These steps run on the machine that hosts the Disco server (not a dev machine) - the one
without router/port-forwarding access.

## 1. Install cloudflared

Download and install `cloudflared` for your OS from Cloudflare's official releases, then
confirm it's on PATH:

    cloudflared --version

## 2. Start the Disco server

    npm start

This keeps listening on `localhost:3000` (or your configured `PORT`) exactly as today.

## 3. Start the tunnel

In a separate terminal, on the same machine:

    cloudflared tunnel --url http://localhost:3000

This prints a random public hostname, e.g.:

    https://some-random-words.trycloudflare.com

This is a *quick tunnel* - free, no Cloudflare account or domain required, but the
hostname changes every time this command is restarted.

## 4. After every tunnel restart, update these 3 places

The hostname from Step 3 must be applied in all three places below, or login/captions
will break:

1. **Server `.env`:** set
   `PUBLIC_BASE_URL=https://some-random-words.trycloudflare.com`, then restart
   `npm start` (this value is only read once, at process startup).
2. **Discord Developer Portal:** open your application -> OAuth2 -> Redirects, and set
   the redirect URI to `https://some-random-words.trycloudflare.com/auth/callback`.
   Discord rejects any redirect that isn't an exact match, so this step is required, not
   optional.
3. **Electron client Settings:** set the server address to
   `some-random-words.trycloudflare.com` (no `https://` prefix, no port). The client
   already auto-detects a bare hostname as "hosted behind TLS" and uses `wss`/`https`
   automatically.

## 5. Verify

- Open the client, log in with Discord, confirm the OAuth flow completes and returns to
  the app.
- Join a voice channel with an active `/disco join` session and confirm captions appear.
- Note how much delay the tunnel hop adds - it should still feel well under 1 second.

## Moving to a stable domain later

Once you have a domain added to a (free) Cloudflare account, switch to a **named
tunnel** (`cloudflared tunnel create <name>` + a Cloudflare-managed DNS route). The
hostname becomes permanent, so steps 4.1-4.3 above only need to be done once, and
`cloudflared` can then run as an auto-restarting background service without breaking
connectivity on every restart.
