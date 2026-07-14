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

// Slides up from the bottom of the (always-visible) avatar header to sit in
// front of the avatars - see .chat-status-banner in app.css. ChatView only
// mounts this while connectionState is reconnecting/unreachable, and with a
// fresh key per status, so it's absent entirely once resolved and replays
// its entrance animation on an unreachable escalation.
export default function ChatStatusBanner({ message, actionLabel, onAction }) {
  return (
    <div className="chat-status-banner">
      <p>{message}</p>
      {actionLabel && <button onClick={onAction}>{actionLabel}</button>}
    </div>
  );
}
