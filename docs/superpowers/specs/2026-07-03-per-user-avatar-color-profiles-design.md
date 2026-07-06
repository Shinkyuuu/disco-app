# Per-User Avatar & Color Profiles - Design

**Status:** Approved, ready for implementation planning.
**Scope:** `client/` only, plus one minimal backend addition (`auth.js`) to let the client learn its own logged-in Discord user_id.

## 1. Goal

Replace the current build-time-bundled, image-only "10 default avatars" system with a runtime-configurable profile system:

- Every speaker resolves to a profile of 4 fields: **silent avatar**, **speaking avatar**, **username color**, **chat color**.
- 10 **default slots**, assigned by join order (unchanged mechanism from today), each independently configurable.
- Arbitrary **friend profiles**, keyed by Discord user_id, that override the default-slot assignment entirely for that person - they never consume a slot.
- A pinned **"Your Profile"** entry - mechanically just a friend profile keyed by your own logged-in user_id, given special placement/styling.
- All of this is configured from a new, consolidated **Settings** page in the launcher window (not the chat window, which keeps its own existing dropdown menu for avatar size/exit).
- Avatar images are stored as real files on disk, swappable by hand; colors live in `electron-store`.

## 2. Non-goals (explicitly out of scope)

- Live-updating an already-open chat window when profiles change in Settings - takes effect next time a chat window opens (matches existing `avatarMode` behavior).
- Packaging/writability concerns for the `resources/` folder once/if this project is ever packaged (this whole project is dev-mode-only today, per the original plan's non-goals).
- Validating that a typed user_id corresponds to a real Discord account - no lookup API is used; it's a raw text field.
- Friend nicknames/labels beyond the raw user_id.
- Any cleanup UI for a previous account's orphaned "self" profile after logging in as someone else (see §6).

## 3. File & data structure

### 3.1 Avatar images - filesystem, not JSON

```
client/resources/avatars/
  defaults/
    01/  silent.png   [speaking.png]
    02/  silent.png   [speaking.png]
    ...
    10/  silent.png   [speaking.png]
  friends/
    <discord-user-id>/  silent.png   [speaking.png]
    <discord-user-id>/  silent.png
```

- `client/resources/` is the existing electron-vite convention already used for the app icon - proven to resolve correctly in dev mode via `app.getAppPath()`. No new resolution mechanism needed.
- The current 10 PNGs (`client/src/renderer/src/assets/avatars/avatar-01.png`..`avatar-10.png`) are migrated here directly as `defaults/01/silent.png`..`defaults/10/silent.png` (same bytes, new location/name) - a one-time repo restructuring done as part of implementation, not a runtime step. Since images live as real committed files rather than data embedded in `electron-store`, there's nothing to "seed" at app startup: the files are simply already there from a fresh clone onward, exactly like any other checked-in asset.
- `speaking.png` is optional per slot/friend. If absent, the silent image is shown continuously while speaking; the existing glow/rise/scale CSS animation is the speaking indicator either way.
- Filename matching is by basename, not fixed extension: the app looks for `silent.*` / `speaking.*`, supporting `.png`/`.jpg`/`.jpeg`/`.webp`/`.gif`.
- **Swapping by hand works:** replace `defaults/03/silent.png` (or any friend's file) directly on disk; restart the app to see it. The in-app picker (§5) writes to these exact same files, so both mechanisms are fully interchangeable - before copying a newly-picked file into place, any existing `silent.*`/`speaking.*` with a *different* extension is deleted first, so there's never ambiguity about which file wins.
- Avatar image bytes are **never** persisted in `electron-store` - they're read fresh from disk whenever needed and handed to the renderer as data URLs. This avoids any sync/duplication risk between "what's on disk" and "what's recorded elsewhere."

### 3.2 Colors & profile existence - `electron-store`

```js
// store.js additions
{
  loggedInUserId: null,           // this account's own Discord user_id, learned at login (§6)
  defaultProfiles: Array.from({ length: 10 }, () => ({
    usernameColor: null,          // null = no override, inherit normal text color
    chatColor: null,
  })),
  friendProfiles: {},             // { [discordUserId]: { usernameColor: null, chatColor: null } }
}
```

- A key existing in `friendProfiles` (even with both colors null) is what makes that user_id "have a custom profile" - i.e. it's what exempts them from the join-order slot rotation. This is checked independently of whether they have any image files.
- **Startup reconciliation** (main process, once per launch): scan `resources/avatars/friends/` for subfolders; any user_id folder found that isn't already a `friendProfiles` key gets a blank entry (`{ usernameColor: null, chatColor: null }`) created automatically. This is what makes a hand-created folder show up correctly in the Settings page without ever having used the "+ Add friend" button.

## 4. Resolution algorithm

Extracted as a pure function (no Electron dependency), colocated with a `node:test` file - same pattern as `backoff.js`/`protocolUrl.js`.

```js
// client/src/renderer/src/resolveAppearance.js
function resolveAppearance({ avatarMode, isSpeaking, discordAvatarURL, profile }) {
  const avatarSrc = avatarMode === 'discord'
    ? discordAvatarURL
    : (isSpeaking ? profile.avatarSpeaking ?? profile.avatarSilent : profile.avatarSilent) ?? discordAvatarURL;
  return {
    avatarSrc,
    usernameColor: profile.usernameColor ?? null, // null → MessageLog omits the style override
    chatColor: profile.chatColor ?? null,
  };
}
```

`profile` is whatever `resolveSpeakerProfile` (§5) returned for that speaker. The precedence that produces `profile` (in the main process, not this pure function):

1. **Friend profile exists for this speakerId?** → read images from `friends/<speakerId>/`, colors from `friendProfiles[speakerId]`. They never consume a default slot.
2. **No friend profile, but among the first 10 distinct speakers this session (join order, unchanged mechanism)?** → read images from `defaults/<slot>/`, colors from `defaultProfiles[slot]`.
3. **Neither** (beyond slot 10, no friend profile) → all fields null; `resolveAppearance` falls back to the Discord avatar and no color override - identical to today's behavior for overflow speakers.

Consequences worth stating explicitly:
- **Avatars only matter in Custom-image mode.** Discord-avatar mode always shows the live Discord avatar, unaffected by any of this.
- **Colors always apply**, in both avatar modes - they style the username and message text in the chat log.
- **"Your Profile" needs zero special-casing here.** It's simply the `friendProfiles` entry keyed by your own `loggedInUserId` - if you're ever a speaker in a channel you're captioning, it resolves through the exact same path as any other friend.

## 5. IPC surface

New main-process module `client/src/main/profiles.js` owns store reads/writes, file I/O (copy/delete/scan), and the startup reconciliation pass. `index.js` registers the IPC handlers that call into it - matching the existing pattern where `store.js`/`wsClient.js` are single-purpose modules `index.js` wires up.

**Read:**
- `resolveSpeakerProfile({ speakerId, slotIndex })` → `{ avatarSilent, avatarSpeaking, usernameColor, chatColor }` (images as data URLs, already resolved per §4's precedence). Called once per newly-seen speaker per chat-window session; the client caches results in a `Map` keyed by speakerId (same pattern as today's `avatarIndexBySpeaker` ref), so this never re-reads disk for someone already resolved this session.
- `getDefaultProfiles()` → array of 10 `{ avatarSilent, avatarSpeaking, usernameColor, chatColor }`, for the Settings page's preview thumbnails.
- `getFriendProfiles()` → `{ [userId]: { avatarSilent, avatarSpeaking, usernameColor, chatColor } }`, same purpose.
- `loggedInUserId` is folded into the existing `getSettings()` response (one more field) rather than a dedicated channel.

**Write:**
- `pickDefaultAvatarImage(slotIndex, kind)` / `pickFriendAvatarImage(userId, kind)` - `kind` is `'silent' | 'speaking'`. Opens a native file-picker restricted to image files; if chosen, copies it into place (deleting any old-extension file first) and returns the new data URL for immediate preview, or `null` if cancelled.
- `setDefaultProfileColors(slotIndex, { usernameColor, chatColor })`
- `addFriendProfile(userId)` - creates a blank entry if not already present (idempotent) - used by the explicit "+ Add friend" flow.
- `setFriendProfileColors(userId, { usernameColor, chatColor })` - **upserts** (creates the entry if missing). This is what lets "Your Profile" work without ever having gone through `addFriendProfile` - the first time you set a field for yourself, the entry is created on the fly.
- `removeFriendProfile(userId)` - deletes the store entry and recursively removes `friends/<userId>/` if it exists. The UI never wires a Remove control to `loggedInUserId`'s own entry - no special backend guard needed for a single-user desktop app.

All get thin preload wrappers in `index.cjs`, following the existing `ipcRenderer.invoke(...)` pattern.

## 6. Learning your own user_id (backend touch)

The client only ever receives an opaque session token - never the actual Discord user_id - by original design (to keep real OAuth material off the client). The self-profile feature needs the client to know "who am I," so:

- `auth.js`'s `handleAuthCallback` already resolves `userId` right before minting the session token. Its success redirect gains one query param:
  ```js
  // before: `discord-echo://auth?token=${sessionToken}`
  // after:
  res.writeHead(302, { Location: `discord-echo://auth?token=${sessionToken}&userId=${encodeURIComponent(userId)}` });
  ```
- `client/src/main/protocolUrl.js` gets a new pure `parseAuthUserId(deepLinkUrl)`, same pattern and same test file as the existing `parseAuthToken`/`parseAuthError`.
- `client/src/main/index.js`'s `deliverAuthToken` becomes `deliverAuthToken(token, userId)`, storing both `sessionToken` and `loggedInUserId`. `handleDeepLink` extracts both params from the same deep link.
- `logout()` clears `loggedInUserId` alongside `sessionToken`.
- `client/src/main/store.js` gets a `loggedInUserId: null` default.

This was evaluated against adding a dedicated `/auth/whoami` HTTP endpoint (header-based token lookup, reusing `verifySessionToken`); the redirect approach was chosen as materially smaller (one query param on an existing response vs. a new route plus a new authenticated fetch call in the client) for the same result.

**Edge case:** if Settings is opened while logged out (no `loggedInUserId`), the "Your Profile" section shows a disabled placeholder ("Log in to configure your own profile") instead of editable fields.

## 7. UI/UX

### 7.1 Navigation

- The launcher's existing small inline settings panel is removed entirely.
- `LauncherView` gains local state (`const [page, setPage] = useState('main')`) toggling between its existing main-page content and the new `<SettingsView />` - no change to `App.jsx`'s top-level routing, since launcher/chat remain separate `BrowserWindow`s with distinct URLs as today; this toggle is entirely internal to what `LauncherView` renders.
- While `SettingsView` is showing, the launcher window resizes larger (~640×560) via the same generic `BrowserWindow.fromWebContents(event.sender)`-based IPC resize already established for the title-bar window controls, then shrinks back on "← Back".
- The title bar (minimize/maximize/close) stays functional throughout, unchanged.
- The launcher's main page becomes just: title bar, **Settings**, **Start Chat Window**, **Log out** (Log out is an account action, stays separate from Settings).

### 7.2 Settings page layout (approved via mockup iteration)

In order, top to bottom:

1. **Connection settings** (moved as-is from the old inline panel): server address, Discord-avatar/Custom-image toggle.
2. **Your Profile** - pinned, visually distinct (accent-bordered card), no Remove button, user_id not editable/shown as an editable field. Same 4-field editor component as everything else, reused.
3. **Default Slots (10)** - compact rows. Each row: slot number, silent-avatar thumbnail (44px, real image) + "Change" button, speaking-avatar thumbnail + "Change"/"Add" button, then username-color and chat-color swatches (22px) each with a text label ("Silent", "Speaking", "Name color", "Chat color") and a "Change"/"Add" affordance. Empty avatar slots show a dashed-border "+" placeholder; empty color swatches show a dashed border.
4. **Friend Overrides** - cards (not rows), one per known user_id, same field styling/labels as the rows above, plus the user_id (monospace) and a solid-background red "Remove" button (matches the title bar's close-button red, `#e81123`) in the card's top-right corner. A trailing "+ Add friend profile" card prompts for a user_id, then reveals the same editor for it.

All buttons/colors reuse the app's existing dark theme values (`#26272d` panels, `#3a3b42` buttons/inputs, `#e81123` for destructive actions) rather than inventing new ones.

### 7.3 Shared component

A single `ProfileFieldsEditor` component (silent-avatar picker+preview, speaking-avatar picker+preview, username-color picker+swatch, chat-color picker+swatch - each field with both a "Change" and a "Clear" affordance) is used by **Your Profile**, each **Default Slot** row, and each **Friend Override** card - one implementation, three call sites, per the "smaller units, one clear purpose" principle. "Clear" always means the same thing regardless of which of the three contexts it's used in: null out that one field, so it falls through to the universal fallback described in §4 (Discord avatar / no color override) - a default slot has nothing further to fall back to besides that same universal fallback, so its Clear behaves identically to a friend/self entry's. Default-slot rows use the component in a horizontal/row arrangement; friend/self cards use it in the card arrangement - same underlying fields and IPC calls either way, just different container layout.

## 8. Repository structure changes

**Remove:**
- `client/src/renderer/src/assets/avatars/` (all 10 PNGs + README.md) - content migrates to `client/resources/avatars/defaults/`.
- `client/src/renderer/src/customAvatars.js` - replaced by IPC-driven resolution; no more build-time glob.

**Add:**
- `client/resources/avatars/defaults/01/silent.png` … `defaults/10/silent.png` (migrated content).
- `client/resources/avatars/friends/` (empty initially).
- `client/src/main/profiles.js` - store reads/writes, file I/O, startup reconciliation (§3.2).
- `client/src/renderer/src/resolveAppearance.js` + `resolveAppearance.test.js` - pure resolution logic (§4).
- `client/src/renderer/src/settings/` - new subdirectory grouping the settings page's pieces:
  - `SettingsView.jsx` - composes everything, owns the "← Back" control and window-resize trigger.
  - `ProfileFieldsEditor.jsx` - shared 4-field editor (§7.3).
  - `YourProfileSection.jsx`
  - `DefaultSlotsSection.jsx`
  - `FriendOverridesSection.jsx`

**Modify:**
- `auth.js` - redirect gains `userId` param (§6).
- `client/src/main/index.js` - new IPC handler registrations; `deliverAuthToken`/`logout` extended for `loggedInUserId`; generic window-resize handler reused for the settings-page resize.
- `client/src/main/store.js` - new default keys (§3.2, §6).
- `client/src/main/protocolUrl.js` - new `parseAuthUserId` (§6).
- `client/src/preload/index.cjs` - new exposed functions for §5's IPC surface.
- `client/src/renderer/src/LauncherView.jsx` - simplified main page; local page-state toggle to `SettingsView`.
- `client/src/renderer/src/ChatView.jsx` - calls `resolveSpeakerProfile` per newly-seen speaker (replacing the old client-side-only `customAvatars`/`assignCustomAvatars`), caches results, passes resolved appearance down.
- `client/src/renderer/src/SpeakerStrip.jsx` - receives a resolved avatar src per member (via `resolveAppearance`) instead of doing its own `customAvatarBySpeaker` lookup; that prop is removed.
- `client/src/renderer/src/MessageLog.jsx` - applies `usernameColor`/`chatColor` inline styles when present.

## 9. Testing scope

- `resolveAppearance.js` gets full `node:test` coverage (pure function, easy to exercise every branch: discord mode, custom mode with/without speaking image, friend override, slot fallback, beyond-slot fallback, null colors).
- `protocolUrl.js`'s new `parseAuthUserId` gets the same test treatment as its siblings.
- Main-process file/IPC glue (`profiles.js`, dialogs, `fs` copy/delete, electron-store reads/writes) is **not** unit tested - matches this project's existing precedent (`store.js`/`index.js` have no tests; they're thin Electron wrappers verified manually).
- Manual verification covers: picking/replacing images for a default slot and a friend, clearing a field back to default, adding/removing a friend profile, hand-editing a file in `resources/avatars/` and confirming the app picks it up next launch, confirming colors/avatars actually apply for a live speaker, and confirming "Your Profile" resolves correctly when the logged-in account itself speaks in a captioned channel.
