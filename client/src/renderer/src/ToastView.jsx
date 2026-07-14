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

// Plain-text message per connectionState.status - the only consumer of this
// copy (ChatView's own error screens keep just their action button, not the
// sentence, so there's no shared/duplicated text to keep in sync elsewhere).
const MESSAGE_BY_STATUS = {
  reconnecting: () => 'Reconnecting…',
  unreachable: (state) => `Can't reach ${state.serverAddress} - still retrying in the background.`,
  'auth-failed': (state) => (state.code === 4001
    ? 'You need to be in the voice channel being captioned.'
    : 'Your session expired - please log in again.'),
  'session-ended': () => 'The bot left the voice channel - captioning has stopped.',
};

export default function ToastView() {
  const [connectionState, setConnectionState] = useState(null);

  useEffect(() => {
    const unsubscribe = window.api.onConnectionState(setConnectionState);
    window.api.getStateSnapshot().then((snapshot) => setConnectionState(snapshot.connectionState));
    return unsubscribe;
  }, []);

  const messageFor = connectionState && MESSAGE_BY_STATUS[connectionState.status];
  if (!messageFor) return null;

  return (
    <div className="toast-root">
      <p>{messageFor(connectionState)}</p>
      <button className="toast-close" onClick={() => window.api.dismissToast()}>
        ×
      </button>
    </div>
  );
}
