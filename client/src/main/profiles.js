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
import { encodeFramesToGif, GifEncodingError } from './gifEncoder.js';

const { app, dialog } = electron;

export const STATIC_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
export const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

// Silent and the Image speaking-type must stay static (no .gif) - mirrors
// the server's extensionsForState (avatarRegistry.js) for the same reason.
export function extensionsForKind(kind) {
  return kind === 'silent' || kind === 'speaking-image' ? STATIC_IMAGE_EXTENSIONS : IMAGE_EXTENSIONS;
}

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

// Find <kind>.* by basename; return absolute path or null. `kind` is
// 'silent', 'speaking-image', 'speaking-gif', or 'speaking-frames'.
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

// avatarSpeaking resolves from whichever variant `speakingAvatarType` names
// ('image'|'gif'|'frames'|null) - the other two saved-but-inactive variants
// stay on disk untouched (Section 3.1 of the design spec: switching types
// never discards the others). A profile with no `speakingAvatarType` set yet
// (every default slot on a fresh install, and any friend/default profile
// from before this field existed) defaults to 'image' - the bundled/legacy
// speaking.* assets were always plain images, and readAvatarDataUrl already
// resolves to null harmlessly if no speaking-image.* file actually exists.
function readImagesFor(scope, id, speakingAvatarType) {
  return {
    avatarSilent: readAvatarDataUrl(scope, id, 'silent'),
    avatarSpeaking: readAvatarDataUrl(scope, id, `speaking-${speakingAvatarType ?? 'image'}`),
  };
}

function readFramesMeta(scope, id) {
  const dir = scopeDir(userAvatarsRoot(), scope, id);
  const bundledDir = scopeDir(bundledAvatarsRoot(), scope, id);
  const metaPath = [dir, bundledDir].map((d) => path.join(d, 'speaking-frames.meta.json')).find((p) => fs.existsSync(p));
  return metaPath ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : null;
}

// Unlike readImagesFor (which only resolves the single active variant, for
// the roster/preview render path), this exposes all three speaking variants
// plus which is active - needed by the Settings UI to render three tabs
// with correct populated/active state. Mirrors the server's
// speakingVariantsFor (avatarRegistry.js, Plan 2 Task 4) for the same reason.
function speakingVariantsFor(scope, id, speakingAvatarType) {
  const image = readAvatarDataUrl(scope, id, 'speaking-image');
  const gif = readAvatarDataUrl(scope, id, 'speaking-gif');
  const framesUrl = readAvatarDataUrl(scope, id, 'speaking-frames');
  const meta = framesUrl ? readFramesMeta(scope, id) : null;
  return {
    activeType: speakingAvatarType ?? 'image',
    image,
    gif,
    frames: framesUrl && meta ? { url: framesUrl, fps: meta.fps, frameCount: meta.frameCount } : null,
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
      ...(isSelf ? { avatarSilent: null, avatarSpeaking: null } : readImagesFor('friend', speakerId, friend.speakingAvatarType)),
      usernameColor: friend.usernameColor ?? null,
      chatColor: friend.chatColor ?? null,
      isFriendOverride: !isSelf,
    };
  }
  if (slotIndex >= 0 && slotIndex < 10) {
    const slot = store.get('defaultProfiles')[slotIndex] ?? { usernameColor: null, chatColor: null };
    return {
      ...readImagesFor('default', slotDirName(slotIndex), slot.speakingAvatarType),
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
    ...readImagesFor('default', slotDirName(i), slot.speakingAvatarType),
    speakingVariants: speakingVariantsFor('default', slotDirName(i), slot.speakingAvatarType),
    usernameColor: slot.usernameColor ?? null,
    chatColor: slot.chatColor ?? null,
  }));
}

export function getFriendProfiles(store) {
  const friendProfiles = store.get('friendProfiles');
  const result = {};
  for (const [id, profile] of Object.entries(friendProfiles)) {
    result[id] = {
      ...readImagesFor('friend', id, profile.speakingAvatarType),
      speakingVariants: speakingVariantsFor('friend', id, profile.speakingAvatarType),
      usernameColor: profile.usernameColor ?? null,
      chatColor: profile.chatColor ?? null,
    };
  }
  return result;
}

// Shared by pickAvatarImage (local overrides, copies the file into userData)
// and pickImageFileForBroadcast (server upload, doesn't copy anywhere locally
// - the caller reads the bytes directly from the returned filePath).
async function pickAndValidateImageFile(title, allowedExtensions) {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title,
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: allowedExtensions.map((e) => e.slice(1)) }],
  });
  if (canceled || filePaths.length === 0) return null;
  const filePath = filePaths[0];
  const ext = path.extname(filePath).toLowerCase();
  if (!allowedExtensions.includes(ext)) return null;
  return { filePath, ext: ext.slice(1) }; // ext without the leading dot, matching the server's ALLOWED_AVATAR_EXTENSIONS
}

// `kind` is 'silent', 'speaking-image', or 'speaking-gif' - 'speaking-frames'
// is written by saveFramesAvatar (Task 2) instead, since it encodes multiple
// source files rather than copying one picked file.
export async function pickAvatarImage({ scope, id, kind }) {
  const picked = await pickAndValidateImageFile(`Choose ${kind} avatar image`, extensionsForKind(kind));
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
  return pickAndValidateImageFile(`Choose ${kind} avatar image to share with others`, extensionsForKind(kind));
}

// Matches the server's MAX_AVATAR_BYTES (avatarRegistry.js) - checked
// client-side right after encoding so an oversized Frames set fails fast
// instead of only being discovered after a round-trip to S3 (broadcast path,
// Task 5) or a wasted local write (this function).
export const MAX_ENCODED_GIF_BYTES = 5 * 1024 * 1024;

// Multi-select dialog for building a Frames set - source images only
// (STATIC_IMAGE_EXTENSIONS), so an animated file can't sneak in as a "frame."
// Returns both the real path (needed later to read bytes for encoding) and a
// data: URL preview read eagerly here, since the renderer's CSP has no
// file: in img-src (client/src/renderer/index.html:13) and so cannot render
// a bare file:// path as a thumbnail.
export async function pickFrameSourceImages() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Choose frame images',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: STATIC_IMAGE_EXTENSIONS.map((e) => e.slice(1)) }],
  });
  if (canceled) return [];
  return filePaths
    .filter((p) => STATIC_IMAGE_EXTENSIONS.includes(path.extname(p).toLowerCase()))
    .map((filePath) => {
      const mime = MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
      const previewUrl = `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
      return { path: filePath, previewUrl };
    });
}

// Encodes frameFilePaths into a GIF (Plan 1), writes it as this profile's
// speaking-frames variant plus a display-only {fps, frameCount} sidecar (the
// GIF itself is the source of truth for playback - the sidecar exists only
// so Settings can show "6 fps - 12 frames" without decoding it), and
// activates it. Raw source frames are not retained - re-editing means
// re-picking from scratch (Section 3.1 of the design spec).
export async function saveFramesAvatar({ store, scope, id, frameFilePaths, fps }) {
  const gifBytes = await encodeFramesToGif(frameFilePaths, fps);
  if (gifBytes.length > MAX_ENCODED_GIF_BYTES) {
    throw new GifEncodingError(`Encoded GIF is ${gifBytes.length} bytes, exceeding the ${MAX_ENCODED_GIF_BYTES}-byte avatar upload limit`);
  }

  const dir = scopeDir(userAvatarsRoot(), scope, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'speaking-frames.gif'), gifBytes);
  fs.writeFileSync(path.join(dir, 'speaking-frames.meta.json'), JSON.stringify({ fps, frameCount: frameFilePaths.length }));

  if (scope === 'default') {
    setDefaultProfileSpeakingType(store, Number(id) - 1, 'frames');
  } else {
    setFriendProfileSpeakingType(store, id, 'frames');
  }
  return readAvatarDataUrl(scope, id, 'speaking-frames');
}

export function clearAvatarImage({ scope, id, kind }) {
  const dir = scopeDir(userAvatarsRoot(), scope, id);
  for (const ext of IMAGE_EXTENSIONS) {
    const file = path.join(dir, `${kind}${ext}`);
    if (fs.existsSync(file)) fs.rmSync(file);
  }
  if (kind === 'speaking-frames') {
    const meta = path.join(dir, 'speaking-frames.meta.json');
    if (fs.existsSync(meta)) fs.rmSync(meta);
  }
}

export function setDefaultProfileColors(store, slotIndex, colors) {
  const defaultProfiles = store.get('defaultProfiles').slice();
  defaultProfiles[slotIndex] = {
    ...defaultProfiles[slotIndex],
    usernameColor: colors.usernameColor ?? null,
    chatColor: colors.chatColor ?? null,
  };
  store.set('defaultProfiles', defaultProfiles);
}

// `type` is 'image'|'gif'|'frames'. Throws if that variant's file doesn't
// exist yet on disk (bundled or user-override) - guards against the
// "switch tabs" IPC path (Task 3) setting an inconsistent active type.
export function setDefaultProfileSpeakingType(store, slotIndex, type) {
  const id = slotDirName(slotIndex);
  const kind = `speaking-${type}`;
  if (!findAvatarFile(scopeDir(userAvatarsRoot(), 'default', id), kind) && !findAvatarFile(scopeDir(bundledAvatarsRoot(), 'default', id), kind)) {
    throw new Error(`No ${type} speaking avatar uploaded yet for default slot ${slotIndex}`);
  }
  const defaultProfiles = store.get('defaultProfiles').slice();
  defaultProfiles[slotIndex] = { ...defaultProfiles[slotIndex], speakingAvatarType: type };
  store.set('defaultProfiles', defaultProfiles);
}

// Nulls speakingAvatarType only if it currently equals the just-cleared
// type - so clearing an inactive variant never disturbs the active one, and
// there's no automatic fallback to another populated variant (matches the
// server's clearAvatar behavior, Plan 2 Task 2).
export function clearDefaultProfileSpeakingTypeIfActive(store, slotIndex, type) {
  const defaultProfiles = store.get('defaultProfiles').slice();
  if (defaultProfiles[slotIndex]?.speakingAvatarType !== type) return;
  defaultProfiles[slotIndex] = { ...defaultProfiles[slotIndex], speakingAvatarType: null };
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
    [userId]: { ...friendProfiles[userId], usernameColor: colors.usernameColor ?? null, chatColor: colors.chatColor ?? null },
  });
}

export function setFriendProfileSpeakingType(store, userId, type) {
  const kind = `speaking-${type}`;
  if (!findAvatarFile(scopeDir(userAvatarsRoot(), 'friend', userId), kind) && !findAvatarFile(scopeDir(bundledAvatarsRoot(), 'friend', userId), kind)) {
    throw new Error(`No ${type} speaking avatar uploaded yet for friend ${userId}`);
  }
  const friendProfiles = store.get('friendProfiles');
  store.set('friendProfiles', { ...friendProfiles, [userId]: { ...friendProfiles[userId], speakingAvatarType: type } });
}

export function clearFriendProfileSpeakingTypeIfActive(store, userId, type) {
  const friendProfiles = store.get('friendProfiles');
  if (friendProfiles[userId]?.speakingAvatarType !== type) return;
  store.set('friendProfiles', { ...friendProfiles, [userId]: { ...friendProfiles[userId], speakingAvatarType: null } });
}

export function removeFriendProfile(store, userId) {
  const friendProfiles = { ...store.get('friendProfiles') };
  delete friendProfiles[userId];
  store.set('friendProfiles', friendProfiles);
  const dir = scopeDir(userAvatarsRoot(), 'friend', userId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
