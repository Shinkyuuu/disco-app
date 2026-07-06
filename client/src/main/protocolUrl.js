function parseDeepLink(deepLinkUrl) {
  try {
    const parsed = new URL(deepLinkUrl);
    return parsed.protocol === 'disco:' ? parsed : null;
  } catch {
    return null;
  }
}

export function parseAuthToken(deepLinkUrl) {
  return parseDeepLink(deepLinkUrl)?.searchParams.get('token') ?? null;
}

export function parseAuthError(deepLinkUrl) {
  return parseDeepLink(deepLinkUrl)?.searchParams.get('error') ?? null;
}

export function parseAuthUserId(deepLinkUrl) {
  return parseDeepLink(deepLinkUrl)?.searchParams.get('userId') ?? null;
}
