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

// The server pings roughly every HEARTBEAT_INTERVAL_MS (see gateway.js) even when
// the voice channel is silent, specifically so a connection proxied through
// something like a Cloudflare tunnel never looks idle to the network in between.
// If this much time passes with no ping (and none arrived at all, for a hung
// handshake), the connection is presumed dead - the tunnel/edge may have dropped
// it without ever delivering a close frame back to this side - and is forced
// closed so the existing reconnect-with-backoff flow below takes over, rather
// than sitting on a socket that looks open but isn't. Only pings rearm this once
// a connection is established: a roster/speaking/transcript message never arrives
// without a ping having arrived first too (the server sends both on the same
// schedule regardless of each other), so re-arming on message traffic as well
// would be redundant - and 'message' is this app's highest-frequency event.
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45000;

export function createWsClient({ serverAddress, token, reconnectBaseDelayMs, heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS }) {
  const emitter = new EventEmitter();
  let attempt = 0;
  let closedByCaller = false;
  let socket = null;
  let reconnectTimer = null;
  let watchdogTimer = null;

  function armWatchdog() {
    clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => socket.terminate(), heartbeatTimeoutMs);
  }

  function clearWatchdog() {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }

  function connect() {
    const scheme = schemeFor(serverAddress, { secure: 'wss', insecure: 'ws' });
    socket = new WebSocket(`${scheme}://${serverAddress}/`);
    // Covers the handshake itself, not just the established connection - a proxy
    // that silently swallows the HTTP Upgrade exchange (TCP connects, but nothing
    // ever comes back) fires neither 'open' nor 'error' nor 'close' on its own,
    // which would otherwise hang this connection attempt forever.
    armWatchdog();

    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'auth', token }));
      attempt = 0;
      armWatchdog();
      emitter.emit('open');
    });

    socket.on('ping', () => armWatchdog());

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
      clearWatchdog();
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
    clearWatchdog();
    socket.close();
  };
  return emitter;
}
