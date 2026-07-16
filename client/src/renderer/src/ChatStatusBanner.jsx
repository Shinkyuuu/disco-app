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

import { useEffect, useState } from 'react';

// Must match .chat-status-banner's transition-duration in app.css - the exit
// (slide back down) is only visible if this component stays mounted for the
// full transition before actually removing its content.
const EXIT_DURATION_MS = 250;

// Always mounted by ChatView (headerOverlay={<ChatStatusBanner banner={...} />}),
// receiving `banner` as null whenever there's nothing to show.
//
// `rendered` lags behind `banner` on the way out, so the exit transition has
// content to animate instead of vanishing immediately. `entered` exists only
// for the very first frame of a fresh appearance - a freshly mounted element
// needs the browser to paint its hidden (translateY(100%)) state at least
// once before adding the --visible class, or the mount and the animated
// state collapse into one paint and the entrance never plays. Re-entering
// visible state exit doesn't need this: `visible` there is a plain
// render-time value derived straight from `banner`, since the element is
// already mounted with a stable "before" state for the transition to run
// from - see the CSS-transition/"adjusting state" reasoning below.
export default function ChatStatusBanner({ banner }) {
  const [rendered, setRendered] = useState(banner);
  const [entered, setEntered] = useState(false);

  // Adjusting state during render (React's own documented pattern for
  // syncing state to a changed prop) rather than inside an effect - this is
  // a plain conditional in the render body, not an effect, so it can't
  // trigger the "setState synchronously in an effect" cascading-render
  // concern. Only fires when the message text actually changes (comparing
  // the string, not the freshly-recreated-every-render banner object), and
  // only resets `entered` on a genuinely fresh appearance (rendered was
  // previously empty), not when one message swaps for another while already
  // visible.
  if (banner && banner.message !== rendered?.message) {
    setRendered(banner);
    if (!rendered) setEntered(false);
  }

  useEffect(() => {
    if (banner) {
      if (entered) return undefined;
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }
    if (!rendered) return undefined;
    const timer = setTimeout(() => setRendered(null), EXIT_DURATION_MS);
    return () => clearTimeout(timer);
  }, [banner, rendered, entered]);

  if (!rendered) return null;

  const visible = Boolean(banner) && entered;

  return (
    <div className={`chat-status-banner${visible ? ' chat-status-banner--visible' : ''}`}>
      <p>{rendered.message}</p>
    </div>
  );
}
