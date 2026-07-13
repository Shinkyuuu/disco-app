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
