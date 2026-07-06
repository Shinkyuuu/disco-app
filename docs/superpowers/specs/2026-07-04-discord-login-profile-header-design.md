# Discord Login Button & Profile Header - Design

**Status:** Approved, ready for implementation planning.
**Scope:** Backend (`bot.js`, `gateway.js`) + client (`main`, `preload`, `renderer`). No change to `auth.js`.

## 1. Goal

The launcher window currently has no explicit login affordance - clicking "Start Chat
Window" while logged out silently kicks off OAuth. This adds:

- A dedicated **"Login to Discord"** button, shown instead of "Start Chat Window" while
  logged out.
- Once logged in, a **profile header** near the top of the launcher showing: avatar,
  username, user_id, and three independent status signals:
  1. **Discord presence** (online/idle/dnd/offline) - the user's real Discord status.
  2. **In tracked voice channel** - whether this user is currently in the voice channel
     the bot is captioning.
  3. **Server reachability** - whether the client can currently reach the discord-echo
     server at all.

## 2. Non-goals

- Any change to `auth.js` or the OAuth flow itself.
- Any change to when/how the caption WebSocket (`wsClient.js`) connects - it still opens
  lazily on "Start Chat Window", exactly as today.
- Live-updating the profile the instant something changes server-side - a 15s poll is
  fresh enough for a screen whose job is "log in, then start the chat window."
- Persisting username/avatar/status in `electron-store` - always fetched fresh.

## 3. Key architectural decision: identity source

Display identity (username, avatar) comes from the **bot's guild member cache**, not
from the OAuth `/users/@me` response. This matches how the app already resolves
speaker/roster identity (`bot.js`'s `resolveSpeaker`/`buildRoster`) - one source of
truth for "what does this Discord user look like," not two. `auth.js` continues to only
resolve and hand back a Discord user_id, unchanged.

Consequence: if the logged-in user isn't a member of `DISCORD_SERVER_ID` (left the
server, or never joined), there's no member record to read - `getUserProfile` returns
`null` and the client shows a "not found in server" fallback state instead of a profile
card.

## 4. Backend changes

### 4.1 `bot.js`

- Add `GatewayIntentBits.GuildPresences` to the client's intents (alongside `Guilds`,
  `GuildVoiceStates`, `GuildMembers`). **Requires a manual step**: enabling "Presence
  Intent" for this bot application in the Discord Developer Portal - the code change
  alone isn't sufficient. This is a prerequisite to implementation, not something the
  code can do.
- On `Events.ClientReady`, call `guild.members.fetch()` once to warm the member cache -
  `member.presence` is only populated for cached members once the intent is granted; a
  one-off REST `guild.members.fetch(userId)` lookup does not include presence data.
- New export:
  ```js
  export function getUserProfile(userId) {
    const guild = client.guilds.cache.get(DISCORD_SERVER_ID);
    const member = guild?.members.cache.get(userId);
    if (!member) return null;
    return {
      username: member.displayName,
      avatarURL: member.displayAvatarURL({ extension: 'png', size: 128 }),
      discordStatus: member.presence?.status ?? 'offline',
      inTrackedChannel: isUserInTrackedChannel(userId),
    };
  }
  ```
  Deliberately reads only from the cache (no `await fetch`) so this stays fast and
  synchronous-feeling for a poll endpoint - a member who isn't cached yet is treated the
  same as "not in server," consistent with presence only ever being available for cached
  members anyway.

### 4.2 `gateway.js`

- New route `GET /api/me` on the existing `http.createServer` handler.
- Reads `Authorization: Bearer <token>`, calls `verifySessionToken(token)` (same as the
  WS auth gate) to resolve `userId`; `401` if missing/invalid.
- Calls `getUserProfile(userId)`; `404` if `null`; otherwise `200` with
  `{ userId, ...profile }` as JSON.
- Structured as an injectable factory - `createMeHandler({ verifyToken, getProfile })`
  - mirroring `createAuthGate`, so it's unit-testable with fakes exactly like
  `gateway.test.js` does today, without a real Discord connection.

## 5. Client - main process

### 5.1 Shared scheme helper

`openLogin` (index.js) and `wsClient.js`'s `connect()` each independently derive
`http`/`ws` vs `https`/`wss` from the same rule (bare `host:port` → plaintext / hosted
hostname → TLS). This change adds a third call site (the profile poll), so that rule is
extracted once into a small shared helper, e.g. `client/src/main/serverScheme.js`:

```js
export function schemeFor(serverAddress, { secure, insecure }) {
  return serverAddress.includes('localhost') || /:\d+$/.test(serverAddress) ? insecure : secure;
}
```

`openLogin` and `wsClient.js` are updated to call it too, so the rule exists in exactly
one place going forward.

### 5.2 `profileClient.js` (new)

```js
export async function fetchProfile({ serverAddress, token }) {
  const scheme = schemeFor(serverAddress, { secure: 'https', insecure: 'http' });
  const res = await fetch(`${scheme}://${serverAddress}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new AuthError();
  if (!res.ok) return null; // 404 (not in server) or transient failure
  return res.json();
}
```

### 5.3 `index.js`

- New `pollProfile()` loop (15s interval): runs whenever a session token exists and
  `launcherWindow` is open. Starts in `deliverAuthToken` and at startup if
  `store.get('sessionToken')` is already set; stops in `logout()` and when
  `launcherWindow` closes.
- Each tick calls `fetchProfile`. On success, sends `profile` over IPC to
  `launcherWindow` as `{ ...result, reachable: true }`. On a network-level failure
  (server unreachable), sends `{ reachable: false }` instead of leaving the renderer
  guessing from silence. On `AuthError` (401), mirrors the existing WS `auth-failed`
  handling: clears `sessionToken`/`loggedInUserId` from the store and notifies the
  renderer so it falls back to the logged-out view.
- New `ipcMain.handle('get-profile', ...)` - a pull, like `get-settings`, giving
  `LauncherView` an immediate value on mount instead of waiting for the first poll tick.

### 5.4 `preload/index.cjs`

- `getProfile()` → `ipcRenderer.invoke('get-profile')`.
- `onProfile()` → `subscribe('profile', ...)`, following the existing pattern.

## 6. Client - renderer

### 6.1 New `ProfileHeader.jsx`

Props: `{ userId, username, avatarURL, discordStatus, inTrackedChannel, reachable }`.
Renders:
- Avatar image, username, and `userId` as smaller secondary text beneath it.
- A colored status dot for `discordStatus` (green=online, yellow=idle, red=dnd,
  gray=offline/unknown) - standard Discord status-dot convention.
- A short "In voice channel" / "Not in voice channel" badge from `inTrackedChannel`.
- A short "Connected" / "Unreachable" indicator from `reachable`.

If the poll ever returns `null` profile data (user not found in the guild), renders a
plain fallback line instead ("Not found in the Discord server") rather than a broken
card.

### 6.2 `LauncherView.jsx`

- New state: `profile` (via `getProfile()` on mount + `onProfile()` subscription).
- **Logged out** (`!settings.hasSessionToken`): render only a **"Login to Discord"**
  button (reuses the existing `openLogin`/`loginError`/retry flow, just relabeled and no
  longer gated behind "Start Chat Window"). Settings button unchanged.
- **Logged in**: render `<ProfileHeader />` at the top of `launcher-content`, above the
  existing Settings / Start Chat Window / Log out buttons (all unchanged otherwise).

## 7. Testing scope

- `gateway.js`'s new `/api/me` handler: unit-tested with injected fakes for
  valid/expired/missing token and found/not-found profile - same pattern as
  `gateway.test.js`'s existing `createAuthGate` tests.
- `serverScheme.js`: focused `node:test` coverage (bare `host:port` vs hosted hostname),
  matching how `protocolUrl.test.js` tests small pure functions today.
- `bot.js`'s `getUserProfile`: not unit tested - matches existing precedent (`bot.js` has
  no unit tests; it's a thin Discord.js wrapper verified manually).
- Manual verification (via the `run` skill): log in and confirm the profile header
  appears with correct avatar/username/user_id; join/leave the tracked voice channel and
  confirm the badge updates within one poll tick; stop the server and confirm
  "Unreachable" appears; log out and confirm the view reverts to "Login to Discord."

## 8. Repository structure changes

**Add:**
- `client/src/main/serverScheme.js` + `serverScheme.test.js`
- `client/src/main/profileClient.js`
- `client/src/renderer/src/ProfileHeader.jsx`

**Modify:**
- `bot.js` - `GuildPresences` intent, member-cache warm-up on ready, new
  `getUserProfile` export.
- `gateway.js` - new `/api/me` route, `createMeHandler` factory.
- `gateway.test.js` - new tests for `createMeHandler`.
- `client/src/main/index.js` - `pollProfile` loop, `get-profile` IPC handler, uses
  `serverScheme.js` in `openLogin`.
- `client/src/main/wsClient.js` - uses `serverScheme.js` instead of its own inline rule.
- `client/src/preload/index.cjs` - `getProfile`/`onProfile`.
- `client/src/renderer/src/LauncherView.jsx` - login-button-only logged-out state,
  `ProfileHeader` when logged in.

**Manual prerequisite (not code):** enable "Presence Intent" for the bot application in
the Discord Developer Portal before `GatewayIntentBits.GuildPresences` will actually
receive presence data.
