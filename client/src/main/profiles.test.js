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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { scopeDir, slotDirName, resolveSpeakerProfile, extensionsForKind, STATIC_IMAGE_EXTENSIONS, IMAGE_EXTENSIONS, clearDefaultProfileSpeakingTypeIfActive, clearFriendProfileSpeakingTypeIfActive } from './profiles.js';

test('scopeDir joins a numeric friend id under the friends subdirectory', () => {
  assert.equal(
    scopeDir('/root', 'friend', '188817283177644044'),
    path.join('/root', 'friends', '188817283177644044'),
  );
});

test('scopeDir joins a numeric default slot id under the defaults subdirectory', () => {
  assert.equal(scopeDir('/root', 'default', '01'), path.join('/root', 'defaults', '01'));
});

test('scopeDir rejects an id containing path traversal segments', () => {
  assert.throws(() => scopeDir('/root', 'friend', '../../../etc'), /Invalid profile id/);
});

test('scopeDir rejects an id containing path separators', () => {
  assert.throws(() => scopeDir('/root', 'friend', '123/456'), /Invalid profile id/);
});

test('scopeDir rejects a non-numeric id', () => {
  assert.throws(() => scopeDir('/root', 'friend', 'abc'), /Invalid profile id/);
});

test('slotDirName returns a zero-padded two-digit name for valid indices', () => {
  assert.equal(slotDirName(0), '01');
  assert.equal(slotDirName(9), '10');
});

test('slotDirName rejects out-of-range indices', () => {
  assert.throws(() => slotDirName(10), RangeError);
  assert.throws(() => slotDirName(-1), RangeError);
});

test('slotDirName rejects non-integer indices', () => {
  assert.throws(() => slotDirName(2.5), RangeError);
  assert.throws(() => slotDirName('2'), RangeError);
});

function fakeStore({ friendProfiles = {}, defaultProfiles = [], loggedInUserId = null } = {}) {
  return {
    get: (key) => {
      if (key === 'friendProfiles') return friendProfiles;
      if (key === 'defaultProfiles') return defaultProfiles;
      if (key === 'loggedInUserId') return loggedInUserId;
      return undefined;
    },
  };
}

// The friend-match and default-slot-match branches of resolveSpeakerProfile
// (isFriendOverride: true / false respectively) both call readImagesFor,
// which reaches app.getPath('userData') and requires a real Electron
// runtime unavailable under `node --test`. Same limitation that already
// leaves pickAvatarImage/clearAvatarImage untested in this file. Those two
// branches are simple, directly-readable boolean literals in
// resolveSpeakerProfile (client/src/main/profiles.js); their correctness
// rests on code review rather than an automated test here.
test('resolveSpeakerProfile marks the empty fallback (no friend, no valid slot) as isFriendOverride: false', () => {
  const store = fakeStore();
  const profile = resolveSpeakerProfile(store, { speakerId: 'user-3', slotIndex: -1 });
  assert.equal(profile.isFriendOverride, false);
});

test("resolveSpeakerProfile never returns local avatar images for the logged-in user's own id, even with a friendProfiles entry", () => {
  const store = fakeStore({
    friendProfiles: { 'self-1': { usernameColor: '#123456', chatColor: '#abcdef' } },
    loggedInUserId: 'self-1',
  });
  const profile = resolveSpeakerProfile(store, { speakerId: 'self-1', slotIndex: -1 });
  assert.equal(profile.avatarSilent, null);
  assert.equal(profile.avatarSpeaking, null);
  assert.equal(profile.isFriendOverride, false);
  assert.equal(profile.usernameColor, '#123456');
  assert.equal(profile.chatColor, '#abcdef');
});

test('extensionsForKind excludes .gif for silent and speaking-image, allows it for speaking-gif', () => {
  assert.deepEqual(extensionsForKind('silent'), STATIC_IMAGE_EXTENSIONS);
  assert.deepEqual(extensionsForKind('speaking-image'), STATIC_IMAGE_EXTENSIONS);
  assert.deepEqual(extensionsForKind('speaking-gif'), IMAGE_EXTENSIONS);
});

function fakeStoreWithProfiles({ defaultProfiles = [], friendProfiles = {} } = {}) {
  return {
    get: (key) => (key === 'defaultProfiles' ? defaultProfiles : key === 'friendProfiles' ? friendProfiles : undefined),
    set: (key, value) => {
      if (key === 'defaultProfiles') defaultProfiles = value;
      if (key === 'friendProfiles') friendProfiles = value;
    },
  };
}

test('clearDefaultProfileSpeakingTypeIfActive nulls speakingAvatarType when it matches the cleared type', () => {
  const store = fakeStoreWithProfiles({ defaultProfiles: [{ usernameColor: null, chatColor: null, speakingAvatarType: 'gif' }] });
  clearDefaultProfileSpeakingTypeIfActive(store, 0, 'gif');
  assert.equal(store.get('defaultProfiles')[0].speakingAvatarType, null);
});

test('clearDefaultProfileSpeakingTypeIfActive leaves speakingAvatarType alone when it does not match the cleared type', () => {
  const store = fakeStoreWithProfiles({ defaultProfiles: [{ usernameColor: null, chatColor: null, speakingAvatarType: 'image' }] });
  clearDefaultProfileSpeakingTypeIfActive(store, 0, 'gif');
  assert.equal(store.get('defaultProfiles')[0].speakingAvatarType, 'image');
});

test('clearFriendProfileSpeakingTypeIfActive nulls speakingAvatarType when it matches the cleared type', () => {
  const store = fakeStoreWithProfiles({ friendProfiles: { 'friend-1': { usernameColor: null, chatColor: null, speakingAvatarType: 'frames' } } });
  clearFriendProfileSpeakingTypeIfActive(store, 'friend-1', 'frames');
  assert.equal(store.get('friendProfiles')['friend-1'].speakingAvatarType, null);
});

test('clearFriendProfileSpeakingTypeIfActive leaves speakingAvatarType alone when it does not match the cleared type', () => {
  const store = fakeStoreWithProfiles({ friendProfiles: { 'friend-1': { usernameColor: null, chatColor: null, speakingAvatarType: 'frames' } } });
  clearFriendProfileSpeakingTypeIfActive(store, 'friend-1', 'gif');
  assert.equal(store.get('friendProfiles')['friend-1'].speakingAvatarType, 'frames');
});
