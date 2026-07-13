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

import { schemeFor } from './serverScheme.js';

export class AuthError extends Error {}

export async function fetchProfile({ serverAddress, token, timeoutMs = 5000 }) {
  const scheme = schemeFor(serverAddress, { secure: 'https', insecure: 'http' });
  const res = await fetch(`${scheme}://${serverAddress}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
    // Without this, a server that accepts the TCP connection but never responds
    // (distinct from an outright connection refusal) leaves this request pending
    // forever - the poll interval keeps firing every 5s regardless, so requests
    // pile up indefinitely instead of ever being treated as unreachable.
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 401) throw new AuthError('session expired');
  if (!res.ok) return null; // 404 (not in guild) or a non-auth server error
  return res.json();
}
