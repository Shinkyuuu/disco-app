import { schemeFor } from './serverScheme.js';

export class AuthError extends Error {}

export async function fetchProfile({ serverAddress, token }) {
  const scheme = schemeFor(serverAddress, { secure: 'https', insecure: 'http' });
  const res = await fetch(`${scheme}://${serverAddress}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new AuthError('session expired');
  if (!res.ok) return null; // 404 (not in guild) or a non-auth server error
  return res.json();
}
