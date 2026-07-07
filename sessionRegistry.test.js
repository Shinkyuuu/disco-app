import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, endSession, getSession, setRoster, activeSessionCount } from './sessionRegistry.js';

test('createSession stores a session retrievable by guildId', () => {
  createSession('guild-a', { channelId: 'chan-1', ownerId: 'user-1', voiceStateListener: null });
  const session = getSession('guild-a');
  assert.equal(session.channelId, 'chan-1');
  assert.equal(session.ownerId, 'user-1');
  assert.deepEqual(session.roster, []);
  endSession('guild-a');
});

test('getSession returns undefined for a guild with no active session', () => {
  assert.equal(getSession('guild-nonexistent'), undefined);
});

test('endSession removes the session and returns the removed entry', () => {
  createSession('guild-b', { channelId: 'chan-2', ownerId: 'user-2', voiceStateListener: null });
  const removed = endSession('guild-b');
  assert.equal(removed.channelId, 'chan-2');
  assert.equal(getSession('guild-b'), undefined);
});

test('endSession on a guild with no session returns undefined', () => {
  assert.equal(endSession('guild-never-existed'), undefined);
});

test('setRoster updates the roster for an existing session', () => {
  createSession('guild-c', { channelId: 'chan-3', ownerId: 'user-3', voiceStateListener: null });
  setRoster('guild-c', [{ speakerId: 'user-3', username: 'Bob' }]);
  assert.deepEqual(getSession('guild-c').roster, [{ speakerId: 'user-3', username: 'Bob' }]);
  endSession('guild-c');
});

test('setRoster is a no-op for a guild with no session', () => {
  setRoster('guild-does-not-exist', [{ speakerId: 'x' }]);
  assert.equal(getSession('guild-does-not-exist'), undefined);
});

test('activeSessionCount reflects the number of currently active sessions', () => {
  const before = activeSessionCount();
  createSession('guild-d', { channelId: 'chan-4', ownerId: 'user-4', voiceStateListener: null });
  createSession('guild-e', { channelId: 'chan-5', ownerId: 'user-5', voiceStateListener: null });
  assert.equal(activeSessionCount(), before + 2);
  endSession('guild-d');
  endSession('guild-e');
  assert.equal(activeSessionCount(), before);
});
