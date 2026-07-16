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

export class AvatarUploadError extends Error {}

async function postJson(url, { token, body, timeoutMs }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new AvatarUploadError(errorBody?.error || `Request to ${url} failed: ${res.status}`);
  }
  return res.json();
}

async function getJson(url, { token, timeoutMs }) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const errorBody = await res.json().catch(() => null);
    throw new AvatarUploadError(errorBody?.error || `Request to ${url} failed: ${res.status}`);
  }
  return res.json();
}

export async function requestAvatarUploadUrl({ serverAddress, token, state, ext, timeoutMs = 5000 }) {
  const scheme = schemeFor(serverAddress, { secure: 'https', insecure: 'http' });
  return postJson(`${scheme}://${serverAddress}/api/avatar/upload-url`, { token, body: { state, ext }, timeoutMs });
}

export async function confirmAvatarUpload({ serverAddress, token, state, version, ext, timeoutMs = 5000 }) {
  const scheme = schemeFor(serverAddress, { secure: 'https', insecure: 'http' });
  return postJson(`${scheme}://${serverAddress}/api/avatar/confirm`, { token, body: { state, version, ext }, timeoutMs });
}

export async function clearBroadcastAvatar({ serverAddress, token, state, timeoutMs = 5000 }) {
  const scheme = schemeFor(serverAddress, { secure: 'https', insecure: 'http' });
  await postJson(`${scheme}://${serverAddress}/api/avatar/clear`, { token, body: { state }, timeoutMs });
}

export async function getBroadcastAvatarUrls({ serverAddress, token, timeoutMs = 5000 }) {
  const scheme = schemeFor(serverAddress, { secure: 'https', insecure: 'http' });
  return getJson(`${scheme}://${serverAddress}/api/avatar/me`, { token, timeoutMs });
}

export async function uploadFileToPresignedUrl({ uploadUrl, fileBuffer, contentType, timeoutMs = 15000 }) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: fileBuffer,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new AvatarUploadError(`Failed to upload image to storage: ${res.status}`);
}
