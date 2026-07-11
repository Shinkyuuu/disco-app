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
    });

    socket.on('close', (code, reasonBuf) => {
      const reason = reasonBuf.toString();
      emitter.emit('close', code, reason);
      if (closedByCaller) return;
      if (AUTH_CLOSE_CODES.has(code)) {
        emitter.emit('auth-failed', reason);
        return;
      }
      const delay = reconnectBaseDelayMs !== undefined
        ? Math.min(reconnectBaseDelayMs * 2 ** attempt, 30000)
        : nextDelay(attempt);
      attempt += 1;
      setTimeout(connect, delay);
    });
  }

  connect();

  emitter.close = () => {
    closedByCaller = true;
    socket.close();
  };
  return emitter;
}
