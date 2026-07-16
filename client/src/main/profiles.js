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

import electron from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const { app, dialog } = electron;

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
export const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function bundledAvatarsRoot() {
  return path.join(app.getAppPath(), 'resources', 'avatars');
}

function userAvatarsRoot() {
  return path.join(app.getPath('userData'), 'avatars');
}

// Every id/index passed here ultimately reaches fs.readFileSync/copyFileSync/rmSync
// (see removeFriendProfile's recursive rmSync in particular) - restricting it to a
// bare numeric string (real Discord snowflakes and slotDirName's zero-padded slot
// numbers both are) closes off '..'/'/' path-traversal from ever reaching a raw
// renderer-supplied userId/slotIndex via IPC.
export function scopeDir(root, scope, id) {
  if (!/^\d{1,32}$/.test(String(id))) {
    throw new Error(`Invalid profile id: ${id}`);
  }
  const sub = scope === 'friend' ? 'friends' : 'defaults';
  return path.join(root, sub, id);
}

// Find silent.* / speaking.* by basename; return absolute path or null.
function findAvatarFile(dir, kind) {
  for (const ext of IMAGE_EXTENSIONS) {
    const candidate = path.join(dir, `${kind}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// Check user-overridden images first, then fall back to bundled app resources.
function readAvatarDataUrl(scope, id, kind) {
  const file =
    findAvatarFile(scopeDir(userAvatarsRoot(), scope, id), kind) ??
    findAvatarFile(scopeDir(bundledAvatarsRoot(), scope, id), kind);
  if (!file) return null;
  const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const b64 = fs.readFileSync(file).toString('base64');
  return `data:${mime};base64,${b64}`;
}

export function slotDirName(slotIndex) {
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= 10) {
    throw new RangeError(`Invalid slot index: ${slotIndex}`);
  }
  return String(slotIndex + 1).padStart(2, '0');
}

function readImagesFor(scope, id) {
  return {
    avatarSilent: readAvatarDataUrl(scope, id, 'silent'),
    avatarSpeaking: readAvatarDataUrl(scope, id, 'speaking'),
  };
}

const DEFAULT_SLOT_COLORS = [
  { usernameColor: '#ee2b2b', chatColor: '#f4afaf' },
  { usernameColor: '#eea02b', chatColor: '#f4d8af' },
  { usernameColor: '#c7ee2b', chatColor: '#e6f4af' },
  { usernameColor: '#52ee2b', chatColor: '#bcf4af' },
  { usernameColor: '#2bee79', chatColor: '#aff4ca' },
  { usernameColor: '#2beeee', chatColor: '#aff4f4' },
  { usernameColor: '#2b79ee', chatColor: '#afcaf4' },
  { usernameColor: '#522bee', chatColor: '#bcaff4' },
  { usernameColor: '#c72bee', chatColor: '#e6aff4' },
  { usernameColor: '#ee2ba0', chatColor: '#f4afd8' },
];

// Runs once at startup: if every default slot is still at its untouched
// null/null state (a fresh install, or one predating this feature), seed
// them with a rainbow palette so speakers get distinguishable colors out of
// the box. A slot the user has actually colored is left alone.
export function seedDefaultProfileColors(store) {
  const defaultProfiles = store.get('defaultProfiles');
  const untouched = defaultProfiles.every((slot) => !slot.usernameColor && !slot.chatColor);
  if (untouched) store.set('defaultProfiles', DEFAULT_SLOT_COLORS);
}

export function reconcileFriendProfiles(store) {
  const friendProfiles = { ...store.get('friendProfiles') };
  let changed = false;
  for (const root of [bundledAvatarsRoot(), userAvatarsRoot()]) {
    const friendsDir = path.join(root, 'friends');
    if (!fs.existsSync(friendsDir)) continue;
    for (const entry of fs.readdirSync(friendsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !(entry.name in friendProfiles)) {
        friendProfiles[entry.name] = { usernameColor: null, chatColor: null };
        changed = true;
      }
    }
  }
  if (changed) store.set('friendProfiles', friendProfiles);
}

// The logged-in user's own entry in friendProfiles (created by the removed
// "Your Profile" UI, or by setting colors via Public Avatar) must never
// surface as an avatar-image override: resolveAppearance.js ranks a friend
// override above the broadcast/Public Avatar tier, which would let a stale
// local image permanently outrank a newly-set Public Avatar for yourself.
// Colors are unaffected - only the avatar images are suppressed for self.
export function resolveSpeakerProfile(store, { speakerId, slotIndex }) {
  const isSelf = speakerId === store.get('loggedInUserId');
  const friend = store.get('friendProfiles')[speakerId];
  if (friend) {
    return {
      ...(isSelf ? { avatarSilent: null, avatarSpeaking: null } : readImagesFor('friend', speakerId)),
      usernameColor: friend.usernameColor ?? null,
      chatColor: friend.chatColor ?? null,
      isFriendOverride: !isSelf,
    };
  }
  if (slotIndex >= 0 && slotIndex < 10) {
    const slot = store.get('defaultProfiles')[slotIndex] ?? { usernameColor: null, chatColor: null };
    return {
      ...readImagesFor('default', slotDirName(slotIndex)),
      usernameColor: slot.usernameColor ?? null,
      chatColor: slot.chatColor ?? null,
      isFriendOverride: false,
    };
  }
  return { avatarSilent: null, avatarSpeaking: null, usernameColor: null, chatColor: null, isFriendOverride: false };
}

export function getDefaultProfiles(store) {
  const colors = store.get('defaultProfiles');
  return colors.map((slot, i) => ({
    ...readImagesFor('default', slotDirName(i)),
    usernameColor: slot.usernameColor ?? null,
    chatColor: slot.chatColor ?? null,
  }));
}

export function getFriendProfiles(store) {
  const friendProfiles = store.get('friendProfiles');
  const result = {};
  for (const [id, colors] of Object.entries(friendProfiles)) {
    result[id] = {
      ...readImagesFor('friend', id),
      usernameColor: colors.usernameColor ?? null,
      chatColor: colors.chatColor ?? null,
    };
  }
  return result;
}

// Shared by pickAvatarImage (local overrides, copies the file into userData)
// and pickImageFileForBroadcast (server upload, doesn't copy anywhere locally
// - the caller reads the bytes directly from the returned filePath).
async function pickAndValidateImageFile(title) {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title,
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS.map((e) => e.slice(1)) }],
  });
  if (canceled || filePaths.length === 0) return null;
  const filePath = filePaths[0];
  const ext = path.extname(filePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.includes(ext)) return null;
  return { filePath, ext: ext.slice(1) }; // ext without the leading dot, matching the server's ALLOWED_AVATAR_EXTENSIONS
}

export async function pickAvatarImage({ scope, id, kind }) {
  const picked = await pickAndValidateImageFile(`Choose ${kind} avatar image`);
  if (!picked) return null;
  const { filePath: source, ext: extNoDot } = picked;
  const ext = `.${extNoDot}`;

  const dir = scopeDir(userAvatarsRoot(), scope, id);
  fs.mkdirSync(dir, { recursive: true });
  // Delete any existing kind.* of a different extension so there's no ambiguity.
  for (const existingExt of IMAGE_EXTENSIONS) {
    const existing = path.join(dir, `${kind}${existingExt}`);
    if (existingExt !== ext && fs.existsSync(existing)) fs.rmSync(existing);
  }
  fs.copyFileSync(source, path.join(dir, `${kind}${ext}`));
  return readAvatarDataUrl(scope, id, kind);
}

// Picks a file for the server-broadcast avatar flow - just validates and
// returns its path/extension, doesn't copy it anywhere. The caller (see
// main/index.js's upload-broadcast-avatar IPC handler) reads the bytes
// itself to hand off to avatarClient.js.
export async function pickImageFileForBroadcast(kind) {
  return pickAndValidateImageFile(`Choose ${kind} avatar image to share with others`);
}

export function clearAvatarImage({ scope, id, kind }) {
  const dir = scopeDir(userAvatarsRoot(), scope, id);
  for (const ext of IMAGE_EXTENSIONS) {
    const file = path.join(dir, `${kind}${ext}`);
    if (fs.existsSync(file)) fs.rmSync(file);
  }
}

export function setDefaultProfileColors(store, slotIndex, colors) {
  const defaultProfiles = store.get('defaultProfiles').slice();
  defaultProfiles[slotIndex] = {
    usernameColor: colors.usernameColor ?? null,
    chatColor: colors.chatColor ?? null,
  };
  store.set('defaultProfiles', defaultProfiles);
}

export function addFriendProfile(store, userId) {
  const friendProfiles = store.get('friendProfiles');
  if (userId in friendProfiles) return;
  store.set('friendProfiles', { ...friendProfiles, [userId]: { usernameColor: null, chatColor: null } });
}

export function setFriendProfileColors(store, userId, colors) {
  const friendProfiles = store.get('friendProfiles');
  store.set('friendProfiles', {
    ...friendProfiles,
    [userId]: { usernameColor: colors.usernameColor ?? null, chatColor: colors.chatColor ?? null },
  });
}

export function removeFriendProfile(store, userId) {
  const friendProfiles = { ...store.get('friendProfiles') };
  delete friendProfiles[userId];
  store.set('friendProfiles', friendProfiles);
  const dir = scopeDir(userAvatarsRoot(), 'friend', userId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
