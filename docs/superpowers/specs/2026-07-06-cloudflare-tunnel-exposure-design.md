# Cloudflare Tunnel Exposure - Design

**Status:** Approved, ready for implementation planning.
**Scope:** Docs/ops only. No changes to `gateway.js`, `auth.js`, `bot.js`, or the client.

## 1. Goal

The Disco server currently only runs reachable on `localhost`. The user has a home
machine to run it on (not this dev machine) but no router access to port-forward. This
adds a documented way to expose that server to the public internet using a Cloudflare
Tunnel, so the Electron client can connect from anywhere without any port forwarding.

## 2. Non-goals

- A stable/custom domain - out of scope for now. This uses Cloudflare's free "quick
  tunnel" (`trycloudflare.com`), which has no signup/domain requirement but issues a new
  random hostname every time the tunnel process restarts.
- Running `cloudflared` as an auto-restarting background service - deferred until a
  domain is added (a named tunnel), since auto-restart plus a rotating hostname would
  silently break connectivity with no notification.
- Any code change to the server or client. Both already read the public address from
  config (`PUBLIC_BASE_URL` env var in `auth.js:26`; `serverAddress` in the client's
  `electron-store`), so exposing the server is purely an operational/config change.

## 3. Architecture

`cloudflared tunnel --url http://localhost:3000` runs manually on the server machine,
alongside `npm start`. Cloudflare's edge terminates TLS and reverse-proxies
`https://<random-words>.trycloudflare.com` (both plain HTTP requests and the WebSocket
upgrade) to `http://localhost:3000`. The Node process never sees TLS - it stays exactly
as it is today, plain HTTP/`ws` on localhost.

## 4. Operational checklist (every time the tunnel restarts)

Because this is a quick tunnel (no domain), the hostname is random and changes on every
`cloudflared` restart. Three places must be updated to match the new hostname:

1. **Server:** set `PUBLIC_BASE_URL=https://<new-subdomain>.trycloudflare.com` in `.env`
   and restart the Node process - `auth.js:26` reads this once at module load, and it
   feeds directly into the OAuth `redirect_uri` (`auth.js:27`).
2. **Discord Developer Portal:** update the application's OAuth2 redirect to
   `https://<new-subdomain>.trycloudflare.com/auth/callback`. Discord rejects any
   `redirect_uri` that isn't an exact match to what's registered, so this step is not
   optional.
3. **Electron client:** update `serverAddress` in Settings to
   `<new-subdomain>.trycloudflare.com` (no port). `serverScheme.js` already treats a bare
   hostname (no `:port` suffix, not `localhost`) as hosted-behind-TLS and picks
   `wss`/`https` automatically - no client code change needed.

When a domain is added later, this whole checklist goes away: a **named tunnel**
(`cloudflared tunnel create` + a Cloudflare-managed DNS route) gets a permanent hostname,
so `PUBLIC_BASE_URL`, the Discord redirect URI, and `serverAddress` are all set once and
never touched again. At that point `cloudflared` can also move to a real auto-restarting
background service, since the hostname is no longer a moving target.

## 5. Deliverables

- `docs/deployment.md`: install `cloudflared`, the run command, and the 3-step
  operational checklist above, written to be followed on the target server machine (not
  this dev machine).
- `.env.example`: comment on `PUBLIC_BASE_URL` clarifying it must exactly match the
  current tunnel hostname and that quick tunnels rotate this on every restart.

## 6. Testing / verification

No automated tests apply (docs-only change). Manual verification, to be performed by the
user on the actual server machine once implemented:

- Start the tunnel, set the 3 config points above, confirm OAuth login round-trips
  end-to-end through the public URL (browser -> Discord -> `/auth/callback` -> `disco://`
  deep link into the Electron client).
- Confirm captions stream correctly over the public `wss://` connection.
- Eyeball added latency from the extra network hop against the product's <1s caption
  budget.

## 7. Repository structure changes

**Add:**
- `docs/deployment.md`

**Modify:**
- `.env.example` - clarifying comment on `PUBLIC_BASE_URL`.
