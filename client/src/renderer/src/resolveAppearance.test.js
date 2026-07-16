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
import { resolveAppearance } from './resolveAppearance.js';

const discord = 'https://cdn/discord.png';
const full = { avatarSilent: 'data:silent', avatarSpeaking: 'data:speaking', usernameColor: '#f00', chatColor: '#0f0' };

test('discord mode always uses the discord avatar', () => {
  const r = resolveAppearance({ avatarMode: 'discord', isSpeaking: true, discordAvatarURL: discord, profile: full });
  assert.equal(r.avatarSrc, discord);
});

test('discord mode still applies color overrides', () => {
  const r = resolveAppearance({ avatarMode: 'discord', isSpeaking: false, discordAvatarURL: discord, profile: full });
  assert.equal(r.usernameColor, '#f00');
  assert.equal(r.chatColor, '#0f0');
});

test('custom mode uses speaking image when speaking', () => {
  const r = resolveAppearance({ avatarMode: 'custom', isSpeaking: true, discordAvatarURL: discord, profile: full });
  assert.equal(r.avatarSrc, 'data:speaking');
});

test('custom mode uses silent image when not speaking', () => {
  const r = resolveAppearance({ avatarMode: 'custom', isSpeaking: false, discordAvatarURL: discord, profile: full });
  assert.equal(r.avatarSrc, 'data:silent');
});

test('custom mode falls back to silent when speaking image missing', () => {
  const profile = { ...full, avatarSpeaking: null };
  const r = resolveAppearance({ avatarMode: 'custom', isSpeaking: true, discordAvatarURL: discord, profile });
  assert.equal(r.avatarSrc, 'data:silent');
});

test('custom mode falls back to discord avatar when no custom images', () => {
  const profile = { avatarSilent: null, avatarSpeaking: null, usernameColor: null, chatColor: null };
  const r = resolveAppearance({ avatarMode: 'custom', isSpeaking: true, discordAvatarURL: discord, profile });
  assert.equal(r.avatarSrc, discord);
});

test('null colors pass through as null', () => {
  const profile = { avatarSilent: null, avatarSpeaking: null, usernameColor: null, chatColor: null };
  const r = resolveAppearance({ avatarMode: 'custom', isSpeaking: false, discordAvatarURL: discord, profile });
  assert.equal(r.usernameColor, null);
  assert.equal(r.chatColor, null);
});

const friendOverride = { avatarSilent: 'data:friend-silent', avatarSpeaking: 'data:friend-speaking', usernameColor: '#f00', chatColor: '#0f0', isFriendOverride: true };
const defaultSlot = { avatarSilent: 'data:default-silent', avatarSpeaking: 'data:default-speaking', usernameColor: '#00f', chatColor: '#0ff', isFriendOverride: false };
const broadcast = { customAvatarSilentURL: 'https://cdn/broadcast-silent.png', customAvatarSpeakingURL: 'https://cdn/broadcast-speaking.png' };

test('custom mode: broadcast avatar wins over a default-slot image when there is no friend override', () => {
  const r = resolveAppearance({ avatarMode: 'custom', isSpeaking: false, discordAvatarURL: discord, profile: defaultSlot, ...broadcast });
  assert.equal(r.avatarSrc, 'https://cdn/broadcast-silent.png');
});

test('custom mode: friend override still wins over a broadcast avatar', () => {
  const r = resolveAppearance({ avatarMode: 'custom', isSpeaking: true, discordAvatarURL: discord, profile: friendOverride, ...broadcast });
  assert.equal(r.avatarSrc, 'data:friend-speaking');
});

test('custom mode: broadcast avatar used when profile has no images at all', () => {
  const profile = { avatarSilent: null, avatarSpeaking: null, usernameColor: null, chatColor: null, isFriendOverride: false };
  const r = resolveAppearance({ avatarMode: 'custom', isSpeaking: true, discordAvatarURL: discord, profile, ...broadcast });
  assert.equal(r.avatarSrc, 'https://cdn/broadcast-speaking.png');
});

test('discord mode ignores broadcast avatars entirely', () => {
  const r = resolveAppearance({ avatarMode: 'discord', isSpeaking: false, discordAvatarURL: discord, profile: defaultSlot, ...broadcast });
  assert.equal(r.avatarSrc, discord);
});

test('custom mode falls back to discord avatar when neither profile nor broadcast has an image', () => {
  const profile = { avatarSilent: null, avatarSpeaking: null, usernameColor: null, chatColor: null, isFriendOverride: false };
  const r = resolveAppearance({ avatarMode: 'custom', isSpeaking: false, discordAvatarURL: discord, profile });
  assert.equal(r.avatarSrc, discord);
});

test('custom mode: broadcast speaking-state avatar falls back to broadcast silent when only silent is set', () => {
  const profile = { avatarSilent: null, avatarSpeaking: null, usernameColor: null, chatColor: null, isFriendOverride: false };
  const r = resolveAppearance({ avatarMode: 'custom', isSpeaking: true, discordAvatarURL: discord, profile, customAvatarSilentURL: 'https://cdn/broadcast-silent.png' });
  assert.equal(r.avatarSrc, 'https://cdn/broadcast-silent.png');
});

test('custom mode: friend override with only avatarSilent set still beats a fully-populated broadcast avatar while speaking', () => {
  const profile = { ...friendOverride, avatarSpeaking: null };
  const r = resolveAppearance({ avatarMode: 'custom', isSpeaking: true, discordAvatarURL: discord, profile, ...broadcast });
  assert.equal(r.avatarSrc, 'data:friend-silent');
});

test('custom mode: broadcast avatar with only customAvatarSilentURL set still beats a fully-populated default-slot profile while speaking', () => {
  const r = resolveAppearance({ avatarMode: 'custom', isSpeaking: true, discordAvatarURL: discord, profile: defaultSlot, customAvatarSilentURL: 'https://cdn/broadcast-silent.png' });
  assert.equal(r.avatarSrc, 'https://cdn/broadcast-silent.png');
});
