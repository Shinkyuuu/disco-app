# Launcher Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the launcher window (main page + Settings) a cohesive "professional and modern" visual pass - new indigo accent color, clearer typographic hierarchy, outlined cards, a proper two-row Settings header, and a real fix for the "no gap below Start Chat Window" layout bug - without changing any page structure, navigation flow, or functional behavior.

**Architecture:** Four isolated CSS/JSX edits to the existing launcher stylesheet (`client/src/renderer/src/assets/app.css`) and the Settings header component (`client/src/renderer/src/settings/SettingsView.jsx`). No new components, no new files, no IPC changes, no test infrastructure changes - this mirrors the two prior small plans executed on this branch (`2026-07-04-settings-inline-page.md`, plus ad hoc fixes), which used manual verification only since there's no automated test coverage for CSS/layout in this codebase.

**Tech Stack:** React (renderer), plain CSS (`app.css`), Electron (unaffected - no main-process changes in this plan).

## Global Constraints

- Accent color: replace every use of `#5865f2` with `#6d5efc` (spec section 1).
- Page title style: 20px, weight 700, margin 0 (spec section 1 & 2).
- Section label style: reuses the existing `.settings-heading` class name - 12px, uppercase, `letter-spacing: 0.04em`, `opacity: 0.6`, weight 600 (spec section 1).
- Card style: `background: transparent`, `border: 1px solid rgba(255, 255, 255, 0.08)` (spec section 3).
- `.start-chat-glow` margin-bottom: `20px` (spec section 5).
- Out of scope (do not touch): the chat overlay window (`ChatView.jsx`, `SpeakerStrip.*`, `MessageLog.jsx`) and its CSS; `BorderGlow.jsx`/`BorderGlow.css` internals; `.launcher-danger-btn`'s color; font family; any page structure or navigation flow change.

---

### Task 1: Accent color tokens + section-label typography

**Files:**
- Modify: `client/src/renderer/src/assets/app.css:184-191` (`.launcher-root`)
- Modify: `client/src/renderer/src/assets/app.css:449-453` (`.settings-heading`)
- Modify: `client/src/renderer/src/assets/app.css:470-472` (`.your-profile`)
- Modify: `client/src/renderer/src/assets/app.css:698-702` (`.profile-header-tag--active`)

**Interfaces:**
- Consumes: nothing (pure CSS value edits, no new classes).
- Produces: the `#6d5efc` accent color value, now used consistently - later tasks (2, 3, 4) reuse this exact hex value for new rules. The `.settings-heading` class keeps its name; only its declared styles change, so no JSX in any file needs editing for this task.

This is a pure CSS-value edit - no JSX changes, no new class names.

- [ ] **Step 1: Swap the accent color in `.launcher-root`**

Current (`app.css:184-191`):
```css
.launcher-root {
  position: relative;
  height: 100%;
  background: #0d0e11;
  border: 1px solid #5865f2;
  display: flex;
  flex-direction: column;
}
```

Change to:
```css
.launcher-root {
  position: relative;
  height: 100%;
  background: #0d0e11;
  border: 1px solid #6d5efc;
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 2: Swap the accent color in `.your-profile`**

Current (`app.css:470-472`):
```css
/* Your Profile - pinned, accent-bordered */
.your-profile {
  border: 1px solid #5865f2;
}
```

Change to:
```css
/* Your Profile - pinned, accent-bordered */
.your-profile {
  border: 1px solid #6d5efc;
}
```

- [ ] **Step 3: Swap the accent color in `.profile-header-tag--active`**

Current (`app.css:698-702`):
```css
.profile-header-tag--active {
  background: rgba(88, 101, 242, 0.18);
  border-color: #5865f2;
  color: #a6b0ff;
}
```

Change to:
```css
.profile-header-tag--active {
  background: rgba(109, 94, 252, 0.18);
  border-color: #6d5efc;
  color: #c5bffe;
}
```

(`rgba(109, 94, 252, ...)` is `#6d5efc` in decimal; `#c5bffe` is the same lightened-tint treatment the old `#a6b0ff` gave `#5865f2`, applied to the new hue.)

- [ ] **Step 4: Restyle `.settings-heading` as a section label**

Current (`app.css:449-453`):
```css
.settings-heading {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
```

Change to:
```css
.settings-heading {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
}
```

- [ ] **Step 5: Manually verify**

There is no automated test covering CSS values in this codebase (consistent with the prior plan on this branch, `2026-07-04-settings-inline-page.md`, which also used manual-only verification). Confirm by reading the file that all four rules above now match their "Change to" blocks exactly, and that no other rule in the file was touched.

- [ ] **Step 6: Commit**

```bash
git add client/src/renderer/src/assets/app.css
git commit -m "style(client): swap blurple accent for indigo, restyle section headings as labels"
```

---

### Task 2: Settings page header restructure

**Files:**
- Modify: `client/src/renderer/src/settings/SettingsView.jsx:26-30`
- Modify: `client/src/renderer/src/assets/app.css:415-428` (`.settings-topbar`, `.settings-title`)

**Interfaces:**
- Consumes: nothing from Task 1 directly (this task defines its own `.settings-title` rule from scratch, superseding the one added in an earlier unrelated change).
- Produces: a `.settings-back-btn` class (new) for the icon-only back button - not consumed elsewhere in this plan, but keep the name in case a later task needs to reference it.

- [ ] **Step 1: Restructure the Settings topbar JSX into two stacked rows**

Current (`SettingsView.jsx:26-30`):
```jsx
      <div className="settings-topbar">
        <button onClick={onBack}>← Back</button>
        <h2 className="settings-title">Settings</h2>
      </div>
```

Change to:
```jsx
      <div className="settings-topbar">
        <button className="settings-back-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
        <h2 className="settings-title">Settings</h2>
      </div>
```

- [ ] **Step 2: Restyle `.settings-topbar` as two stacked rows, finalize `.settings-title`, add `.settings-back-btn`**

Current (`app.css:415-428`):
```css
.settings-topbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid #26272d;
}

.settings-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
```

Change to:
```css
.settings-topbar {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px 14px;
  border-bottom: 1px solid #26272d;
}

.settings-back-btn {
  padding: 4px 10px;
  font-size: 14px;
  line-height: 1;
}

.settings-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}
```

- [ ] **Step 3: Manually verify**

Run: `cd client && npm run dev` (kill any already-running dev instance first - main-process files aren't touched by this task, but the app should be freshly launched to check a clean render; see the note on `ELECTRON_RUN_AS_NODE` below if launching from an agent shell)

Note: if launching the Electron client from an automated/agent shell rather than a normal terminal, the shell may have `ELECTRON_RUN_AS_NODE=1` set in its environment (inherited from a host Electron process), which makes `electron.exe` run as plain Node instead of launching the app - producing an error like `SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'`. If you hit that, prefix the command with `env -u ELECTRON_RUN_AS_NODE` (bash) to clear it for the child process only.

In the running app: open Settings, confirm the back button renders as a small icon-only `←` control with no "Back" text, sitting alone above a bold, noticeably larger "Settings" title on its own row beneath it.

- [ ] **Step 4: Commit**

```bash
git add client/src/renderer/src/settings/SettingsView.jsx client/src/renderer/src/assets/app.css
git commit -m "feat(client): restructure Settings header into icon-only back button + page title"
```

---

### Task 3: Outlined card style for Settings sections and the profile header

**Files:**
- Modify: `client/src/renderer/src/assets/app.css:443-447` (`.settings-section`)
- Modify: `client/src/renderer/src/assets/app.css:638-648` (`.profile-header`)

**Interfaces:**
- Consumes: nothing from prior tasks (independent CSS-only edit).
- Produces: nothing consumed by later tasks.

`.your-profile` (which combines with `.settings-section` on the same DOM element in `YourProfileSection.jsx`, e.g. `className="settings-section your-profile"`) needs no separate edit here - it only sets `border-color` (already updated to `#6d5efc` in Task 1) and inherits the new transparent background from `.settings-section` automatically, since both classes apply to the same element.

- [ ] **Step 1: Make `.settings-section` outlined instead of filled**

Current (`app.css:443-447`):
```css
.settings-section {
  background: #26272d;
  border-radius: 8px;
  padding: 12px;
}
```

Change to:
```css
.settings-section {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 12px;
}
```

- [ ] **Step 2: Make `.profile-header` outlined instead of filled**

Current (`app.css:638-648`):
```css
.profile-header {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  background: #26272d;
  border-radius: 8px;
  margin-bottom: 14px;
}
```

Change to:
```css
.profile-header {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  margin-bottom: 14px;
}
```

- [ ] **Step 3: Manually verify**

Run the app (see Task 2 Step 3 for the `ELECTRON_RUN_AS_NODE` note if needed). Confirm:
- On the main page (logged in or "Server unreachable"/"Not found" state), the profile header box shows a thin subtle border with the same near-black background as the page behind it, not a solid gray fill.
- In Settings, all four section boxes (Connection, Your Profile, Default Slots, Friend Overrides) show the same outlined treatment; "Your Profile" additionally shows its indigo `#6d5efc` border (from Task 1) rather than a second background color.

- [ ] **Step 4: Commit**

```bash
git add client/src/renderer/src/assets/app.css
git commit -m "style(client): switch settings-section and profile-header cards to outlined style"
```

---

### Task 4: Secondary-button hover accent + glow-button spacing fix

**Files:**
- Modify: `client/src/renderer/src/assets/app.css:67-69` (`button:hover`)
- Modify: `client/src/renderer/src/assets/app.css:290-292` (`.launcher-danger-btn:hover`)
- Modify: `client/src/renderer/src/assets/app.css:265-269` (add a new `.start-chat-glow` rule near the existing `.start-chat-glow .launcher-primary-btn` rules)

**Interfaces:**
- Consumes: the `#6d5efc` accent value established in Task 1.
- Produces: nothing consumed by later tasks (this is the last task in the plan).

- [ ] **Step 1: Add an accent border-color to the global button hover state**

Current (`app.css:67-69`):
```css
button:hover {
  background: #26272d;
}
```

Change to:
```css
button:hover {
  background: #26272d;
  border-color: #6d5efc;
}
```

- [ ] **Step 2: Keep the Log out button's hover border red, not indigo**

`.launcher-danger-btn:hover` doesn't currently set `border-color`, so without this step it would inherit the new indigo `border-color` from Step 1 via the global `button:hover` rule (a class+pseudo selector only overrides properties it explicitly redeclares - anything it doesn't redeclare still comes from the lower-specificity rule). The spec says the danger button's red styling is unchanged.

Current (`app.css:290-292`):
```css
.launcher-danger-btn:hover {
  background: rgba(232, 17, 35, 0.22);
}
```

Change to:
```css
.launcher-danger-btn:hover {
  background: rgba(232, 17, 35, 0.22);
  border-color: #e81123;
}
```

- [ ] **Step 3: Add real margin below the glow button to clear its shadow bleed**

Current (`app.css:265-269`):
```css
.start-chat-glow .launcher-primary-btn {
  width: 100%;
  background: transparent;
  border: none;
}
```

Add a new rule immediately before it (do not modify the existing rule):
```css
.start-chat-glow {
  margin-bottom: 20px;
}

.start-chat-glow .launcher-primary-btn {
  width: 100%;
  background: transparent;
  border: none;
}
```

- [ ] **Step 4: Manually verify**

Run the app (see Task 2 Step 3 for the `ELECTRON_RUN_AS_NODE` note if needed). Confirm:
- Hovering any plain button (e.g. Settings, the new icon-only Back button) shows an indigo border on hover.
- Hovering "Log out" still shows its red border on hover, not indigo.
- On the main page, in both the normal logged-in state and the "Server unreachable" state, there is now a clearly visible gap between the "Start Chat Window" button (including its glow) and the Settings/Log out row beneath it - check both states, since the spec notes the shadow-bleed bug affects all three `ProfileHeader` render branches, not just the one originally reported.

- [ ] **Step 5: Commit**

```bash
git add client/src/renderer/src/assets/app.css
git commit -m "style(client): add accent hover border to buttons, fix missing gap below glow button"
```

---

## Self-Review Notes

- **Spec coverage:** Spec section 1 (tokens) → Task 1 + the `.settings-title` finalization in Task 2 (page title is visually introduced there). Spec section 2 (Settings header) → Task 2. Spec section 3 (outlined cards) → Task 3. Spec section 4 (main page accent + button consistency) → Task 1 (`.profile-header-tag--active`) + Task 4 (button hover). Spec section 5 (spacing fix) → Task 4. All five spec sections have a covering task.
- **No placeholders:** every step shows complete before/after CSS or JSX; verification steps are concrete manual actions (no automated test exists for CSS/layout in this codebase, consistent with the prior plan executed on this branch).
- **Type/name consistency:** `.settings-back-btn` and `.start-chat-glow` (new rule) are each introduced and used within the same task - no cross-task name mismatches. The `#6d5efc` hex value and its `rgba(109, 94, 252, ...)` decimal equivalent are used identically across Tasks 1 and 4.
