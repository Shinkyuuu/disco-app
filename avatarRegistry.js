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
import crypto from 'node:crypto';
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as defaultGetSignedUrl } from '@aws-sdk/s3-request-presigner';

export class AvatarValidationError extends Error {}

export const ALLOWED_AVATAR_STATES = ['silent', 'speaking'];
export const ALLOWED_AVATAR_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB
const UPLOAD_URL_TTL_SECONDS = 300; // 5 minutes

function manifestKey(userId) {
  return `avatars/${userId}/manifest.json`;
}

function objectKey(userId, version, state, ext) {
  return `avatars/${userId}/${version}-${state}.${ext}`;
}

function isNotFoundError(err) {
  return err?.name === 'NoSuchKey' || err?.name === 'NotFound' || err?.$metadata?.httpStatusCode === 404;
}

async function streamToString(body) {
  if (typeof body.transformToString === 'function') return body.transformToString();
  const chunks = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// Wraps S3 (via an injected client, so tests never make real AWS calls) with
// the upload lifecycle (requestUploadUrl/confirmUpload), restart-recoverable
// resolution (resolveAvatarUrls, Task 2), and clearing (clearAvatar, Task 3).
// No discord.js dependency - kept swappable/testable in isolation, same
// rationale as sessionRegistry.js.
export function createAvatarRegistry({ s3Client, bucket, cdnBaseUrl, getSignedUrl = defaultGetSignedUrl }) {
  // userId -> { silentURL, speakingURL } | null (null = confirmed no custom avatar)
  const registry = new Map();

  function urlFor(userId, manifest, state) {
    const entry = manifest?.[state];
    if (!entry) return null;
    return `${cdnBaseUrl}/${objectKey(userId, entry.version, state, entry.ext)}`;
  }

  function urlsFromManifest(userId, manifest) {
    return {
      silentURL: urlFor(userId, manifest, 'silent'),
      speakingURL: urlFor(userId, manifest, 'speaking'),
    };
  }

  async function readManifest(userId) {
    try {
      const res = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: manifestKey(userId) }));
      return JSON.parse(await streamToString(res.Body));
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  async function writeManifest(userId, manifest) {
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: manifestKey(userId),
      Body: JSON.stringify(manifest),
      ContentType: 'application/json',
    }));
  }

  async function requestUploadUrl(userId, state, ext) {
    if (!ALLOWED_AVATAR_STATES.includes(state)) throw new AvatarValidationError(`Invalid avatar state: ${state}`);
    if (!ALLOWED_AVATAR_EXTENSIONS.includes(ext)) throw new AvatarValidationError(`Invalid avatar extension: ${ext}`);
    const version = crypto.randomBytes(8).toString('hex');
    const key = objectKey(userId, version, state, ext);
    const uploadUrl = await getSignedUrl(
      s3Client,
      new PutObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );
    return { uploadUrl, version };
  }

  async function confirmUpload(userId, state, version, ext) {
    if (!ALLOWED_AVATAR_STATES.includes(state)) throw new AvatarValidationError(`Invalid avatar state: ${state}`);
    if (!ALLOWED_AVATAR_EXTENSIONS.includes(ext)) throw new AvatarValidationError(`Invalid avatar extension: ${ext}`);
    const key = objectKey(userId, version, state, ext);

    let head;
    try {
      head = await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    } catch (err) {
      if (isNotFoundError(err)) throw new AvatarValidationError('Uploaded object not found - upload may have failed or expired');
      throw err;
    }
    if ((head.ContentLength ?? 0) > MAX_AVATAR_BYTES) {
      throw new AvatarValidationError(`Uploaded avatar exceeds the ${MAX_AVATAR_BYTES}-byte limit`);
    }

    const manifest = (await readManifest(userId)) ?? {};
    manifest[state] = { version, ext };
    manifest.updatedAt = Date.now();
    await writeManifest(userId, manifest);

    const urls = urlsFromManifest(userId, manifest);
    registry.set(userId, urls);
    return urls[`${state}URL`];
  }

  function getCachedAvatarUrls(userId) {
    return registry.get(userId);
  }

  async function resolveAvatarUrls(userId) {
    if (registry.has(userId)) return registry.get(userId);
    const manifest = await readManifest(userId);
    if (!manifest) {
      registry.set(userId, null);
      return null;
    }
    const urls = urlsFromManifest(userId, manifest);
    registry.set(userId, urls);
    return urls;
  }

  async function clearAvatar(userId, state) {
    if (!ALLOWED_AVATAR_STATES.includes(state)) throw new AvatarValidationError(`Invalid avatar state: ${state}`);
    const manifest = (await readManifest(userId)) ?? {};
    manifest[state] = null;
    manifest.updatedAt = Date.now();
    await writeManifest(userId, manifest);

    const urls = urlsFromManifest(userId, manifest);
    registry.set(userId, urls.silentURL || urls.speakingURL ? urls : null);
  }

  return { requestUploadUrl, confirmUpload, getCachedAvatarUrls, resolveAvatarUrls, clearAvatar };
}

const { AWS_REGION, S3_AVATAR_BUCKET, AVATAR_CDN_BASE_URL } = process.env;
if (!S3_AVATAR_BUCKET || !AVATAR_CDN_BASE_URL || !AWS_REGION) {
  throw new Error('AWS_REGION, S3_AVATAR_BUCKET, and AVATAR_CDN_BASE_URL env vars are required for broadcast avatars');
}

export const avatarRegistry = createAvatarRegistry({
  s3Client: new S3Client({ region: AWS_REGION }),
  bucket: S3_AVATAR_BUCKET,
  cdnBaseUrl: AVATAR_CDN_BASE_URL,
});
