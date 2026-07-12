function parseDeepLink(deepLinkUrl) {
  try {
    const parsed = new URL(deepLinkUrl);
    return parsed.protocol === 'disco:' ? parsed : null;
  } catch {
    return null;
  }
}

// The bearer session token itself never travels in this URL - only a one-time
// exchange code (see auth.js's createExchangeCode/handleAuthExchange), redeemed
// for the real token via a POST request instead.
export function parseAuthCode(deepLinkUrl) {
  return parseDeepLink(deepLinkUrl)?.searchParams.get('code') ?? null;
}

export function parseAuthError(deepLinkUrl) {
  return parseDeepLink(deepLinkUrl)?.searchParams.get('error') ?? null;
}
