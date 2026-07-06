import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialTypewriterState, tick, TICK_MS } from './typewriter.js';

const messages = ['Hi', 'Yo', 'Ok'];

function tickN(state, n) {
  for (let i = 0; i < n; i++) state = tick(state, messages);
  return state;
}

test('types one character at a time while typing', () => {
  let state = initialTypewriterState();
  state = tick(state, messages);
  assert.equal(state.phase, 'typing');
  assert.equal(state.displayedLength, 0);
  state = tick(state, messages);
  assert.equal(state.displayedLength, 1);
});

test('moves to holding once the message is fully typed', () => {
  const state = tickN(initialTypewriterState(), 4);
  assert.equal(state.phase, 'holding');
  assert.equal(state.displayedLength, messages[0].length);
  assert.equal(state.elapsedInPhaseMs, 0);
});

test('stays in holding for the full 30s hold, then starts deleting', () => {
  const fullyTyped = tickN(initialTypewriterState(), 4);
  const ticksToHold = 30000 / TICK_MS;
  const stillHolding = tickN(fullyTyped, ticksToHold - 1);
  assert.equal(stillHolding.phase, 'holding');
  const deleting = tick(stillHolding, messages);
  assert.equal(deleting.phase, 'deleting');
  assert.equal(deleting.displayedLength, messages[0].length);
});

test('deletes one character at a time, then advances to the next message', () => {
  const fullyTyped = tickN(initialTypewriterState(), 4);
  const ticksToHold = 30000 / TICK_MS;
  let state = tickN(fullyTyped, ticksToHold);
  assert.equal(state.phase, 'deleting');
  state = tick(state, messages);
  assert.equal(state.displayedLength, 1);
  state = tick(state, messages);
  assert.equal(state.phase, 'typing');
  assert.equal(state.messageIndex, 1);
  assert.equal(state.displayedLength, 0);
});

test('wraps from the last message back to the first', () => {
  let state = initialTypewriterState(messages.length - 1);
  const ticksToHold = 30000 / TICK_MS;
  state = tickN(state, 4 + ticksToHold + 2);
  assert.equal(state.phase, 'typing');
  assert.equal(state.messageIndex, 0);
});
