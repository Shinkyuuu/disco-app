/*
 * Copyright 2026 Cody Park
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Drawn as crossed lines (not a "×" glyph) so it sits pixel-centered in the
// button regardless of font metrics - see TitleBar.jsx's CloseIcon.
function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.4" />
      <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

// Absolutely positioned below the title bar (see .error-banner in app.css) so
// it overlays without shifting any other component's position. The parent
// controls the auto-dismiss timer and mounts/unmounts this - a fresh mount
// per distinct message (see LauncherView's `key={banner}`) is what makes the
// slide-down CSS animation replay for each new error, including one that
// immediately follows a previous one.
export default function ErrorBanner({ message, onDismiss }) {
  return (
    <div className="error-banner" role="alert">
      <p>{message}</p>
      <button className="error-banner-close" aria-label="Dismiss" onClick={onDismiss}>
        <CloseIcon />
      </button>
    </div>
  );
}
