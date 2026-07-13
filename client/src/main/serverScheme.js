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

// Bare host:port (local dev) → plaintext; hostname without a port (hosted,
// behind TLS) → secure. Shared by openLogin (index.js), wsClient.js, and
// profileClient.js so the rule exists in exactly one place.
export function schemeFor(serverAddress, { secure, insecure }) {
  return serverAddress.includes('localhost') || /:\d+$/.test(serverAddress) ? insecure : secure;
}
