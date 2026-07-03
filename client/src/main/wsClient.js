import { EventEmitter } from 'node:events';
import WebSocket from 'ws';

export function createWsClient({ serverAddress, token }) {
  const emitter = new EventEmitter();
  const ws = new WebSocket(`ws://${serverAddress}/`);

  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'auth', token }));
    emitter.emit('open');
  });

  ws.on('message', (data) => {
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

  ws.on('close', (code, reasonBuf) => {
    emitter.emit('close', code, reasonBuf.toString());
  });

  emitter.close = () => ws.close();
  return emitter;
}
