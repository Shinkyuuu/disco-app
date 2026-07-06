# Aurora Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an animated ReactBits-style aurora gradient background (blue → violet → blue) behind a new bordered, rounded-corner foreground container on the launcher window and settings page.

**Architecture:** Port the ReactBits Aurora WebGL component (GLSL noise shader via the `ogl` library) into `Aurora.jsx`/`Aurora.css`, the same way `BorderGlow.jsx` was already adapted from ReactBits. Mount it once in `LauncherView.jsx` behind both pages (main + settings, which are alternately-rendered siblings under one title bar), and restyle the existing `.launcher-content` / `.settings-scroll` containers into bordered, rounded cards that float above it.

**Tech Stack:** React 19, Electron (electron-vite), `ogl` (new dependency - WebGL2 renderer, no other deps).

## Global Constraints

- Colors: aurora `colorStops` are `['#3b82f6', '#7C3AED', '#3b82f6']` (blue → violet → blue), per the design spec.
- Card styling: `background: #0d0e11`, `border: 1px solid rgba(255, 255, 255, 0.12)`, `border-radius: 14px` on both foreground containers.
- No new npm test coverage - this is a visual/animation feature with no unit-testable logic (matches the existing `BorderGlow.jsx` precedent, which also has no test file). Verification is manual: run the app and look at it.
- Don't touch the chat window/overlay - this only affects the launcher window and settings page.
- Don't change any existing inner card borders (`.settings-section`, `.your-profile`, friend cards, `.profile-header`) - they stay nested inside the new outer card unchanged.

---

### Task 1: Add the `ogl` dependency

**Files:**
- Modify: `client/package.json`

**Interfaces:**
- Produces: `ogl` importable as `import { Renderer, Program, Mesh, Color, Triangle } from 'ogl'` for Task 2.

- [ ] **Step 1: Install the package**

Run from the `client` directory:

```bash
npm install ogl
```

Expected: `client/package.json` gains an `ogl` entry under `"dependencies"`, and `client/package-lock.json` updates.

- [ ] **Step 2: Verify it resolves**

Run:

```bash
node -e "require.resolve('ogl/package.json')" --prefix client
```

(If that form doesn't work on your shell, just confirm `client/node_modules/ogl` exists.)

Expected: no error / directory exists.

- [ ] **Step 3: Commit**

```bash
git add client/package.json client/package-lock.json
git commit -m "chore(client): add ogl dependency for aurora background"
```

---

### Task 2: Create the `Aurora` component

**Files:**
- Create: `client/src/renderer/src/Aurora.jsx`
- Create: `client/src/renderer/src/Aurora.css`

**Interfaces:**
- Consumes: `ogl`'s `Renderer`, `Program`, `Mesh`, `Color`, `Triangle` (Task 1).
- Produces: `export default function Aurora({ colorStops, amplitude, blend, speed })` - a React component rendering a `<div className="aurora-container">` containing a WebGL `<canvas>` that fills its parent. Used by `LauncherView.jsx` in Task 3 as `<Aurora colorStops={[...]} />`.

- [ ] **Step 1: Write `Aurora.css`**

```css
.aurora-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
```

- [ ] **Step 2: Write `Aurora.jsx`**

```jsx
import { useEffect, useRef } from 'react';
import { Renderer, Program, Mesh, Color, Triangle } from 'ogl';
import './Aurora.css';

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;

out vec4 fragColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v) {
  const vec4 C = vec4(
      0.211324865405187, 0.366025403784439,
      -0.577350269189626, 0.024390243902439
  );
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);

  vec3 p = permute(
      permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0)
  );

  vec3 m = max(
      0.5 - vec3(
          dot(x0, x0),
          dot(x12.xy, x12.xy),
          dot(x12.zw, x12.zw)
      ),
      0.0
  );
  m = m * m;
  m = m * m;

  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);

  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

struct ColorStop {
  vec3 color;
  float position;
};

#define COLOR_RAMP(colors, factor, finalColor) {              \\
  int index = 0;                                              \\
  for (int i = 0; i < 2; i++) {                                \\
     ColorStop currentColor = colors[i];                       \\
     bool isInBetween = currentColor.position <= factor;       \\
     index = int(mix(float(index), float(i), float(isInBetween))); \\
  }                                                             \\
  ColorStop currentColor = colors[index];                       \\
  ColorStop nextColor = colors[index + 1];                      \\
  float range = nextColor.position - currentColor.position;     \\
  float lerpFactor = (factor - currentColor.position) / range;  \\
  finalColor = mix(currentColor.color, nextColor.color, lerpFactor); \\
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  ColorStop colors[3];
  colors[0] = ColorStop(uColorStops[0], 0.0);
  colors[1] = ColorStop(uColorStops[1], 0.5);
  colors[2] = ColorStop(uColorStops[2], 1.0);

  vec3 rampColor;
  COLOR_RAMP(colors, uv.x, rampColor);

  float height = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25)) * 0.5 * uAmplitude;
  height = exp(height);
  height = (uv.y * 2.0 - height + 0.2);
  float intensity = 0.6 * height;

  float midPoint = 0.20;
  float auroraAlpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);

  vec3 auroraColor = intensity * rampColor;

  fragColor = vec4(auroraColor * auroraAlpha, auroraAlpha);
}
`;

// Adapted from the ReactBits "Aurora" component
// (https://www.reactbits.dev/backgrounds/aurora): renders an animated
// aurora-style gradient via a WebGL2 simplex-noise fragment shader. Props
// are read through a ref each frame so the render loop doesn't need to
// restart when they change.
export default function Aurora(props) {
  const { colorStops = ['#5227FF', '#7cff67', '#5227FF'], amplitude = 1.0, blend = 0.5 } = props;
  const propsRef = useRef(props);
  propsRef.current = props;

  const ctnDom = useRef(null);

  useEffect(() => {
    const ctn = ctnDom.current;
    if (!ctn) return;

    const renderer = new Renderer({
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
    });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.canvas.style.backgroundColor = 'transparent';

    let program;

    function resize() {
      if (!ctn) return;
      const width = ctn.offsetWidth;
      const height = ctn.offsetHeight;
      renderer.setSize(width, height);
      if (program) {
        program.uniforms.uResolution.value = [width, height];
      }
    }
    window.addEventListener('resize', resize);

    const geometry = new Triangle(gl);
    if (geometry.attributes.uv) {
      delete geometry.attributes.uv;
    }

    const colorStopsArray = colorStops.map((hex) => {
      const c = new Color(hex);
      return [c.r, c.g, c.b];
    });

    program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: amplitude },
        uColorStops: { value: colorStopsArray },
        uResolution: { value: [ctn.offsetWidth, ctn.offsetHeight] },
        uBlend: { value: blend },
      },
    });

    const mesh = new Mesh(gl, { geometry, program });
    ctn.appendChild(gl.canvas);

    let animateId = 0;
    const update = (t) => {
      animateId = requestAnimationFrame(update);
      const { time = t * 0.01, speed = 1.0 } = propsRef.current;
      program.uniforms.uTime.value = time * speed * 0.1;
      program.uniforms.uAmplitude.value = propsRef.current.amplitude ?? 1.0;
      program.uniforms.uBlend.value = propsRef.current.blend ?? blend;
      const stops = propsRef.current.colorStops ?? colorStops;
      program.uniforms.uColorStops.value = stops.map((hex) => {
        const c = new Color(hex);
        return [c.r, c.g, c.b];
      });
      renderer.render({ scene: mesh });
    };
    animateId = requestAnimationFrame(update);

    resize();

    return () => {
      cancelAnimationFrame(animateId);
      window.removeEventListener('resize', resize);
      if (ctn && gl.canvas.parentNode === ctn) {
        ctn.removeChild(gl.canvas);
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [amplitude, colorStops, blend]);

  return <div ref={ctnDom} className="aurora-container"></div>;
}
```

- [ ] **Step 3: Lint it**

Run from the `client` directory:

```bash
npm run lint
```

Expected: no new errors from `Aurora.jsx`/`Aurora.css`. (If eslint flags the shader template literals for line length or similar, that's fine to leave - this is a direct port; don't reformat the GLSL.)

- [ ] **Step 4: Commit**

```bash
git add client/src/renderer/src/Aurora.jsx client/src/renderer/src/Aurora.css
git commit -m "feat(client): add Aurora background component adapted from ReactBits"
```

---

### Task 3: Mount Aurora behind both pages and turn the content areas into foreground cards

**Files:**
- Modify: `client/src/renderer/src/LauncherView.jsx`
- Modify: `client/src/renderer/src/assets/app.css`

**Interfaces:**
- Consumes: `Aurora` default export from Task 2 (`client/src/renderer/src/Aurora.jsx`).

- [ ] **Step 1: Import `Aurora` in `LauncherView.jsx`**

In `client/src/renderer/src/LauncherView.jsx`, add the import alongside the existing ones:

```js
import BorderGlow from './BorderGlow';
import Aurora from './Aurora';
```

- [ ] **Step 2: Wrap the page switch in an `aurora-stage`**

Replace the entire `return` statement in `LauncherView.jsx` - this is the full, exact current block:

```jsx
  return (
    <div className="launcher-root">
      <TitleBar title="Disco" />
      {page === 'settings' ? (
        <SettingsView
          settings={settings}
          onSettingsChange={handleSettingsChange}
          onBack={() => {
            setPage('main');
            reloadOwnAppearance(settings.loggedInUserId);
          }}
        />
      ) : (
        <div className="launcher-content">
          <h1 className="launcher-title"></h1>
          {loginError && (
            <div role="alert">
              <p>{loginError}</p>
              <button onClick={handleLogin}>Retry</button>
            </div>
          )}
          {settings.hasSessionToken ? (
            <>
              <ProfileHeader
                profile={profileState.profile}
                reachable={profileState.reachable}
                avatarMode={settings.avatarMode}
                peekProfile={ownAppearance}
              />
              <BorderGlow className="start-chat-glow" backgroundColor="#6d5efc" borderRadius={8} glowRadius={14}>
                <button className="launcher-primary-btn" onClick={() => window.api.startChatWindow()}>
                  <ChatIcon />
                  Start Chat Window
                </button>
              </BorderGlow>
              <div className="launcher-button-row">
                <button onClick={() => setPage('settings')}>
                  <SettingsIcon />
                  Settings
                </button>
                <button
                  className="launcher-danger-btn"
                  onClick={() => window.api.logout().then(() => window.api.getSettings().then(setSettings))}
                >
                  <LogoutIcon />
                  Log out
                </button>
              </div>
            </>
          ) : (
            <>
              <button onClick={() => setPage('settings')}>
                <SettingsIcon />
                Settings
              </button>
              <button onClick={handleLogin}>
                <LoginIcon />
                Login to Discord
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

with this (adds the `aurora-stage`/`aurora-backdrop`/`Aurora` wrapper right after `TitleBar`, and indents the existing ternary one level deeper - its contents are otherwise byte-for-byte unchanged):

```jsx
  return (
    <div className="launcher-root">
      <TitleBar title="Disco" />
      <div className="aurora-stage">
        <div className="aurora-backdrop">
          <Aurora colorStops={['#3b82f6', '#7C3AED', '#3b82f6']} />
        </div>
        {page === 'settings' ? (
          <SettingsView
            settings={settings}
            onSettingsChange={handleSettingsChange}
            onBack={() => {
              setPage('main');
              reloadOwnAppearance(settings.loggedInUserId);
            }}
          />
        ) : (
          <div className="launcher-content">
            <h1 className="launcher-title"></h1>
            {loginError && (
              <div role="alert">
                <p>{loginError}</p>
                <button onClick={handleLogin}>Retry</button>
              </div>
            )}
            {settings.hasSessionToken ? (
              <>
                <ProfileHeader
                  profile={profileState.profile}
                  reachable={profileState.reachable}
                  avatarMode={settings.avatarMode}
                  peekProfile={ownAppearance}
                />
                <BorderGlow className="start-chat-glow" backgroundColor="#6d5efc" borderRadius={8} glowRadius={14}>
                  <button className="launcher-primary-btn" onClick={() => window.api.startChatWindow()}>
                    <ChatIcon />
                    Start Chat Window
                  </button>
                </BorderGlow>
                <div className="launcher-button-row">
                  <button onClick={() => setPage('settings')}>
                    <SettingsIcon />
                    Settings
                  </button>
                  <button
                    className="launcher-danger-btn"
                    onClick={() => window.api.logout().then(() => window.api.getSettings().then(setSettings))}
                  >
                    <LogoutIcon />
                    Log out
                  </button>
                </div>
              </>
            ) : (
              <>
                <button onClick={() => setPage('settings')}>
                  <SettingsIcon />
                  Settings
                </button>
                <button onClick={handleLogin}>
                  <LoginIcon />
                  Login to Discord
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify the JSX is balanced**

Run from the `client` directory:

```bash
npm run lint
```

Expected: no unbalanced-JSX / parse errors. Fix any mismatched tags flagged.

- [ ] **Step 4: Add the new CSS rules to `app.css`**

In `client/src/renderer/src/assets/app.css`, immediately after the `/* --- launcher window --- */` block's `.launcher-root` rule (around line 192, right after its closing `}`), add:

```css
.aurora-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.aurora-backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}
```

- [ ] **Step 5: Turn `.launcher-content` into the foreground card**

Replace the existing `.launcher-content` rule:

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

with:

```css
.launcher-content {
  position: relative;
  z-index: 1;
  flex: 1;
  width: 100%;
  max-width: 480px;
  margin: 20px auto;
  padding: 32px 20px 20px;
  background: #0d0e11;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: stretch;
}
```

- [ ] **Step 6: Turn the settings page's content into a transparent stage + foreground card**

Replace the existing `.settings-view` rule:

```css
.settings-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #0d0e11;
}
```

with:

```css
.settings-view {
  position: relative;
  z-index: 1;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
```

Then replace the existing `.settings-scroll` rule:

```css
.settings-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  width: 100%;
  max-width: 900px;
  margin: 0 auto;
  padding: 12px 12px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
```

with:

```css
.settings-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  width: 100%;
  max-width: 900px;
  margin: 16px auto;
  padding: 12px 12px 20px;
  background: #0d0e11;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
```

- [ ] **Step 7: Run the app and verify visually**

Run from the `client` directory:

```bash
npm run dev
```

Expected, in the launcher window that opens:
- Below the title bar, a blue-violet aurora gradient animates continuously.
- The button/profile content sits inside a rounded, bordered dark card with visible aurora-lit space around it.
- Clicking "Settings" shows the same aurora behind the settings page, with the settings list in its own rounded bordered card, and the back button / "Settings" title visible directly over the aurora (no card behind them).
- Existing inner cards (Your Profile, default slots, friend cards) still show their own borders, nested inside the new outer card.
- No console errors in the DevTools console (View → Toggle Developer Tools, or it may auto-open in dev mode).

Close the app (or leave it running if you want to keep eyeballing it) once confirmed.

- [ ] **Step 8: Commit**

```bash
git add client/src/renderer/src/LauncherView.jsx client/src/renderer/src/assets/app.css
git commit -m "feat(client): add animated aurora background behind launcher and settings pages"
```
