import crypto from 'node:crypto';

const SESSION_TOKEN_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// token -> { userId, expiresAt }
const sessionTokens = new Map();

export function createSessionToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessionTokens.set(token, { userId, expiresAt: Date.now() + SESSION_TOKEN_TTL_MS });
  return token;
}

export function verifySessionToken(token) {
  const entry = sessionTokens.get(token);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    sessionTokens.delete(token);
    return null;
  }
  return entry.userId;
}
