import { schemeFor } from './serverScheme.js';

export class AuthExchangeError extends Error {}

// Redeems the one-time code from a disco:// auth deep link for the real,
// long-lived bearer session token - see auth.js's createExchangeCode/
// handleAuthExchange for why this is a POST body and not a URL.
export async function exchangeAuthCode({ serverAddress, code }) {
  const scheme = schemeFor(serverAddress, { secure: 'https', insecure: 'http' });
  const res = await fetch(`${scheme}://${serverAddress}/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new AuthExchangeError(`auth exchange failed: ${res.status}`);
  return res.json();
}
