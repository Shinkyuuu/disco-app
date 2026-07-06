import { app, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function avatarsRoot() {
  return path.join(app.getAppPath(), 'resources', 'avatars');
}

function scopeDir(scope, id) {
  const sub = scope === 'friend' ? 'friends' : 'defaults';
  return path.join(avatarsRoot(), sub, id);
}

// Find silent.* / speaking.* by basename; return absolute path or null.
function findAvatarFile(dir, kind) {
  for (const ext of IMAGE_EXTENSIONS) {
    const candidate = path.join(dir, `${kind}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readAvatarDataUrl(dir, kind) {
  const file = findAvatarFile(dir, kind);
  if (!file) return null;
  const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const b64 = fs.readFileSync(file).toString('base64');
  return `data:${mime};base64,${b64}`;
}

function slotDirName(slotIndex) {
  return String(slotIndex + 1).padStart(2, '0');
}

function readImagesFor(scope, id) {
  const dir = scopeDir(scope, id);
  return {
    avatarSilent: readAvatarDataUrl(dir, 'silent'),
    avatarSpeaking: readAvatarDataUrl(dir, 'speaking'),
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
  const friendsDir = path.join(avatarsRoot(), 'friends');
  if (!fs.existsSync(friendsDir)) return;
  const friendProfiles = { ...store.get('friendProfiles') };
  let changed = false;
  for (const entry of fs.readdirSync(friendsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !(entry.name in friendProfiles)) {
      friendProfiles[entry.name] = { usernameColor: null, chatColor: null };
      changed = true;
    }
  }
  if (changed) store.set('friendProfiles', friendProfiles);
}

export function resolveSpeakerProfile(store, { speakerId, slotIndex }) {
  const friend = store.get('friendProfiles')[speakerId];
  if (friend) {
    return {
      ...readImagesFor('friend', speakerId),
      usernameColor: friend.usernameColor ?? null,
      chatColor: friend.chatColor ?? null,
    };
  }
  if (slotIndex >= 0 && slotIndex < 10) {
    const slot = store.get('defaultProfiles')[slotIndex] ?? { usernameColor: null, chatColor: null };
    return {
      ...readImagesFor('default', slotDirName(slotIndex)),
      usernameColor: slot.usernameColor ?? null,
      chatColor: slot.chatColor ?? null,
    };
  }
  return { avatarSilent: null, avatarSpeaking: null, usernameColor: null, chatColor: null };
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

export async function pickAvatarImage({ scope, id, kind }) {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: `Choose ${kind} avatar image`,
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS.map((e) => e.slice(1)) }],
  });
  if (canceled || filePaths.length === 0) return null;

  const source = filePaths[0];
  const ext = path.extname(source).toLowerCase();
  if (!IMAGE_EXTENSIONS.includes(ext)) return null;

  const dir = scopeDir(scope, id);
  fs.mkdirSync(dir, { recursive: true });
  // Delete any existing kind.* of a different extension so there's no ambiguity.
  for (const existingExt of IMAGE_EXTENSIONS) {
    const existing = path.join(dir, `${kind}${existingExt}`);
    if (existingExt !== ext && fs.existsSync(existing)) fs.rmSync(existing);
  }
  fs.copyFileSync(source, path.join(dir, `${kind}${ext}`));
  return readAvatarDataUrl(dir, kind);
}

export function clearAvatarImage({ scope, id, kind }) {
  const dir = scopeDir(scope, id);
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
  const dir = scopeDir('friend', userId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
