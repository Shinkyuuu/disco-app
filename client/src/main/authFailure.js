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

// 4001 (not in voice channel) means the token is still valid - the user is just
// not currently in the tracked VC (and might join it later) - so it must not be
// treated the same as an actually-bad token (invalid/expired: 4002/4003/4008),
// which requires clearing the stored token and forcing a fresh login. Keyed on
// the numeric close code (see gateway.js), not the close reason's exact text -
// matching on that text would silently break if the server's wording ever changed.
export function isRetryableAuthFailure(code) {
  return code === 4001;
}
