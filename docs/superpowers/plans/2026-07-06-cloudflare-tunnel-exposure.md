# Cloudflare Tunnel Exposure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document how to expose the Disco server (running on a separate home machine) to the public internet via a Cloudflare quick tunnel, with no code changes.

**Architecture:** `cloudflared tunnel --url http://localhost:3000` runs manually on the server machine. Cloudflare's edge terminates TLS and proxies a random `https://<subdomain>.trycloudflare.com` hostname to the local plain HTTP/WS server. No server or client code changes - both already read the public address from config (`PUBLIC_BASE_URL` in `auth.js`, `serverAddress` in the Electron client's settings).

**Tech Stack:** `cloudflared` CLI (Cloudflare Tunnel), no new dependencies.

## Global Constraints

- Docs-only change. No modifications to `gateway.js`, `auth.js`, `bot.js`, or any client code.
- This uses Cloudflare's free "quick tunnel" (no domain) - the hostname rotates on every `cloudflared` restart. A named tunnel with a stable domain is a documented future step, not part of this plan.
- All steps in this plan are to be followed on the target server machine (a separate machine from wherever this plan is executed), not the current dev machine.

---

### Task 1: Write deployment docs and clarify `.env.example`

**Files:**
- Create: `docs/deployment.md`
- Modify: `.env.example:10-11`

**Interfaces:**
- Consumes: existing `PUBLIC_BASE_URL` env var (`auth.js:26`), existing `serverAddress` client setting (`client/src/main/store.js:5`), existing `serverScheme.js` bare-hostname-vs-`host:port` rule.
- Produces: nothing consumed by other tasks - this is the only task in this plan.

- [ ] **Step 1: Write `docs/deployment.md`**

```markdown
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
```

- [ ] **Step 2: Update `.env.example`**

Change:
```
# PUBLIC_BASE_URL - hosted-deployment only, e.g. https://captions.yourdomain.com; leave unset for local dev
PUBLIC_BASE_URL=
```
to:
```
# PUBLIC_BASE_URL - hosted-deployment only, e.g. https://captions.yourdomain.com; leave unset for local dev.
# Must exactly match your Cloudflare Tunnel hostname and the redirect URI registered in the
# Discord Developer Portal - see docs/deployment.md. Quick tunnels (no domain) get a new
# hostname on every restart, so this value (and the Discord redirect URI) must be updated
# each time.
PUBLIC_BASE_URL=
```

- [ ] **Step 3: Commit**

```bash
git add docs/deployment.md .env.example
git commit -m "docs: add Cloudflare Tunnel deployment guide"
```
