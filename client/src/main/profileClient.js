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
