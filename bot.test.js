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

import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GatewayRateLimitError } from 'discord.js';
import { resolveMaxActiveSessions, extractFluxTranscript, ensureMembersFetched } from './bot.js';

test('resolveMaxActiveSessions defaults to 5 when unset', () => {
  assert.equal(resolveMaxActiveSessions(undefined), 5);
});

test('resolveMaxActiveSessions defaults to 5 for an empty string', () => {
  assert.equal(resolveMaxActiveSessions(''), 5);
});

test('resolveMaxActiveSessions parses a valid numeric string', () => {
  assert.equal(resolveMaxActiveSessions('10'), 10);
});

test('resolveMaxActiveSessions falls back to 5 for a non-numeric value instead of disabling the cap', () => {
  assert.equal(resolveMaxActiveSessions('not-a-number'), 5);
});

test('extractFluxTranscript returns the transcript on an EndOfTurn TurnInfo message', () => {
  const msg = { type: 'TurnInfo', event: 'EndOfTurn', transcript: 'hello there' };
  assert.equal(extractFluxTranscript(msg), 'hello there');
});

test('extractFluxTranscript ignores intermediate Update events', () => {
  const msg = { type: 'TurnInfo', event: 'Update', transcript: 'hello' };
  assert.equal(extractFluxTranscript(msg), null);
});

test('extractFluxTranscript ignores non-TurnInfo messages (e.g. Connected, Error)', () => {
  assert.equal(extractFluxTranscript({ type: 'Connected' }), null);
  assert.equal(extractFluxTranscript({ type: 'Error', code: 'INTERNAL_SERVER_ERROR' }), null);
});

test('extractFluxTranscript returns null for an EndOfTurn with an empty transcript', () => {
  const msg = { type: 'TurnInfo', event: 'EndOfTurn', transcript: '' };
  assert.equal(extractFluxTranscript(msg), null);
});

test('ensureMembersFetched does not retry a guild while its rate-limit cooldown is active', async () => {
  let calls = 0;
  const guild = {
    id: `rate-limited-guild-${Date.now()}`,
    members: {
      fetch: async () => {
        calls++;
        if (calls === 1) {
          throw new GatewayRateLimitError({ retry_after: 0.1, opcode: 8, meta: {} }, {});
        }
      },
    },
  };

  await ensureMembersFetched(guild);
  assert.equal(calls, 1);

  await ensureMembersFetched(guild);
  assert.equal(calls, 1, 'should not retry while the rate-limit retry_after window is still active');

  await new Promise((resolve) => setTimeout(resolve, 150));

  await ensureMembersFetched(guild);
  assert.equal(calls, 2, 'should retry once the retry_after window has elapsed');
});
