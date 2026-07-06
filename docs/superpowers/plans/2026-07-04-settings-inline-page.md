# Settings Inline Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Settings page render inline in the launcher window without triggering a window resize, and give it the same side-gutter treatment as the main page but a wider content cap.

**Architecture:** Two isolated edits: (1) delete the resize-on-mount/unmount effect in `SettingsView.jsx`, (2) restyle `.settings-scroll` in `app.css` to mirror `.launcher-content`'s centered-column pattern with a larger max-width. No new components, no IPC changes, no test infrastructure changes.

**Tech Stack:** React (renderer), plain CSS (`app.css`), Electron IPC via `window.api` (preload bridge).

## Global Constraints

- No change to the launcher window's default construction size (still 440×560) or to any `resizable`/min-width constraints (spec: "Out of scope").
- No change to `.settings-topbar`, `.settings-section`, or any section components' internal layout (spec: "Out of scope").
- No change to `.launcher-content` or the main page (spec: "Out of scope" - already centered per the prior design doc).
- Settings content column max-width: `640px` (spec section 2, chosen to match the width Settings used to force via resize).
- Side padding on `.settings-scroll`: `20px` (spec section 2, matches `.launcher-content`'s side padding).

---

### Task 1: Remove the forced window resize from SettingsView

**Files:**
- Modify: `client/src/renderer/src/settings/SettingsView.jsx:1-19`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new - this task only removes a side effect. `SettingsView`'s props/behavior otherwise unchanged (still calls `reload()` on mount).

Current code (lines 1-19):

```jsx
import { useEffect, useState } from 'react';
import YourProfileSection from './YourProfileSection';
import DefaultSlotsSection from './DefaultSlotsSection';
import FriendOverridesSection from './FriendOverridesSection';

export default function SettingsView({ settings, onSettingsChange, onBack }) {
  const [defaultProfiles, setDefaultProfiles] = useState([]);
  const [friendProfiles, setFriendProfiles] = useState({});

  function reload() {
    window.api.getDefaultProfiles().then(setDefaultProfiles);
    window.api.getFriendProfiles().then(setFriendProfiles);
  }

  useEffect(() => {
    window.api.resizeWindow(640, 560);
    reload();
    return () => window.api.resizeWindow(440, 560);
  }, []);
```

- [ ] **Step 1: Remove the resize calls, keep the reload-on-mount behavior**

Replace the `useEffect` block so it only calls `reload()`:

```jsx
import { useEffect, useState } from 'react';
import YourProfileSection from './YourProfileSection';
import DefaultSlotsSection from './DefaultSlotsSection';
import FriendOverridesSection from './FriendOverridesSection';

export default function SettingsView({ settings, onSettingsChange, onBack }) {
  const [defaultProfiles, setDefaultProfiles] = useState([]);
  const [friendProfiles, setFriendProfiles] = useState({});

  function reload() {
    window.api.getDefaultProfiles().then(setDefaultProfiles);
    window.api.getFriendProfiles().then(setFriendProfiles);
  }

  useEffect(() => {
    reload();
  }, []);
```

The rest of the file (from `const loggedInUserId = ...` to the closing `}`) is unchanged.

- [ ] **Step 2: Manually verify no resize on open/close**

This behavior isn't covered by existing automated tests (no test file exists for `SettingsView.jsx`, and window-resize IPC calls aren't something `protocolUrl.test.js`-style unit tests touch). Verify manually:

Run: `cd client && npm run dev` (or the project's existing dev-launch command - check `client/package.json` `scripts` if `npm run dev` doesn't exist)

In the running app:
1. Note the launcher window's width.
2. Click "Settings". Confirm the window width does not change.
3. Click "← Back". Confirm the window width still does not change.

- [ ] **Step 3: Commit**

```bash
git add client/src/renderer/src/settings/SettingsView.jsx
git commit -m "fix(client): stop resizing the launcher window when opening Settings"
```

---

### Task 2: Restyle `.settings-scroll` to match the main page's gutter pattern with a wider cap

**Files:**
- Modify: `client/src/renderer/src/assets/app.css:421-429`

**Interfaces:**
- Consumes: nothing (pure CSS change).
- Produces: nothing consumed elsewhere - `.settings-scroll` is only referenced by `SettingsView.jsx`'s existing `<div className="settings-scroll">`, which is unchanged by this task.

Current rule (lines 421-429):

```css
.settings-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
```

For reference, the main page's pattern this should mirror (`.launcher-content`, lines 240-250, **not modified by this task**):

```css
.launcher-content {
  flex: 1;
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  padding: 32px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: stretch;
}
```

- [ ] **Step 1: Update `.settings-scroll`**

```css
.settings-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  padding: 12px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
```

(Keeps the existing `12px` top padding and `16px` gap - only the side padding changes from `14px` to `20px`, and `width: 100%` / `max-width: 640px` / `margin: 0 auto` are added.)

- [ ] **Step 2: Manually verify the gutter and cap**

Run: `cd client && npm run dev` (or the project's existing dev-launch command)

In the running app:
1. At the default window width, open Settings and confirm the left/right gutter visually matches the main page's gutter (both ~20px).
2. Drag the launcher window wider than 680px (640px content + 20px×2 padding). Confirm the Settings content column stops growing at 640px and centers with margin on both sides, while a quick check of the main page (Back button) shows it capped at the narrower 480px.

- [ ] **Step 3: Commit**

```bash
git add client/src/renderer/src/assets/app.css
git commit -m "style(client): give the settings page the same side gutters as the main page, wider cap"
```

---

## Self-Review Notes

- **Spec coverage:** Spec section 1 (remove forced resize) → Task 1. Spec section 2 (gutter/cap match) → Task 2. Spec's "Out of scope" items (window default size, `resizable`/min-width, `.settings-topbar`, `.settings-section`, main page) are untouched by both tasks - confirmed no task modifies them.
- **No placeholders:** both tasks show complete before/after code; verification steps are concrete manual actions (no automated test exists for this window-resize/CSS-layout behavior, consistent with the spec's own "Verification" section, which lists only manual checks).
- **Type/name consistency:** N/A - no new functions, props, or shared identifiers introduced across tasks.
