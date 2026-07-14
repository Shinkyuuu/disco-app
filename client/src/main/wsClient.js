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

import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { nextDelay } from './backoff.js';
import { schemeFor } from './serverScheme.js';

const AUTH_CLOSE_CODES = new Set([4001, 4002, 4003, 4008]);

export function createWsClient({ serverAddress, token, reconnectBaseDelayMs }) {
  const emitter = new EventEmitter();
  let attempt = 0;
  let closedByCaller = false;
  let socket = null;
  let reconnectTimer = null;

  function connect() {
    const scheme = schemeFor(serverAddress, { secure: 'wss', insecure: 'ws' });
    socket = new WebSocket(`${scheme}://${serverAddress}/`);

    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'auth', token }));
      attempt = 0;
      emitter.emit('open');
    });

    // A failed handshake (e.g. a 502 from a proxy while the server is down or
    // restarting) is an 'error' event with no listener by default - Node
    // throws and kills the whole Electron main process. Log it and let the
    // 'close' handler below (which always follows) drive the existing
    // reconnect-with-backoff flow.
    socket.on('error', (err) => {
      console.error('WebSocket error:', err);
    });

    socket.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.type === 'roster') emitter.emit('roster', msg.members);
      else if (msg.type === 'speaking') emitter.emit('speaking', { speakerId: msg.speakerId, isSpeaking: msg.isSpeaking });
      else if (msg.type === 'transcript') emitter.emit('transcript', msg);
      else if (msg.type === 'session-ended') emitter.emit('session-ended');
    });

    socket.on('close', (code, reasonBuf) => {
      const reason = reasonBuf.toString();
      emitter.emit('close', code, reason);
      if (closedByCaller) return;
      if (AUTH_CLOSE_CODES.has(code)) {
        // The numeric code, not just the human-readable reason text, so callers
        // can branch on a stable value instead of matching the server's exact
        // close-reason string (fragile - the same class of bug as a typo in that
        // string silently breaking whatever matched it).
        emitter.emit('auth-failed', reason, code);
        return;
      }
      const delay = reconnectBaseDelayMs !== undefined
        ? Math.min(reconnectBaseDelayMs * 2 ** attempt, 30000)
        : nextDelay(attempt);
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    });
  }

  connect();

  emitter.close = () => {
    closedByCaller = true;
    // Without this, a reconnect already scheduled (but not yet fired) when the
    // caller closes keeps running on its own after close() returns - opening a
    // fresh socket with a token/state the caller has since considered gone.
    clearTimeout(reconnectTimer);
    socket.close();
  };
  return emitter;
}
