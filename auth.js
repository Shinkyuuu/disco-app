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

const { DISCORD_APPLICATION_ID, DISCORD_CLIENT_SECRET } = process.env;
const PORT_NUMBER = process.env.PORT || 3000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT_NUMBER}`;
const REDIRECT_URI = `${PUBLIC_BASE_URL}/auth/callback`;

export function buildAuthorizeUrl() {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', DISCORD_APPLICATION_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', 'identify');
  return url.toString();
}

export function handleAuthLogin(req, res) {
  res.writeHead(302, { Location: buildAuthorizeUrl() });
  res.end();
}

async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    client_id: DISCORD_APPLICATION_ID,
    client_secret: DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Discord token exchange failed: ${res.status}`);
  return res.json();
}

async function fetchDiscordUserId(accessToken) {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Discord user fetch failed: ${res.status}`);
  const user = await res.json();
  return user.id;
}

export async function handleAuthCallback(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT_NUMBER}`);

  // Discord redirects here with ?error=access_denied (standard OAuth2 behavior) when the
  // user declines on the consent screen — forward it through the same deep-link mechanism
  // as a success, carrying an error instead of a token, so the Electron app can show a
  // real in-app retry state instead of leaving the user stuck on a bare browser page.
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    res.writeHead(302, { Location: `discord-echo://auth?error=${encodeURIComponent(oauthError)}` });
    res.end();
    return;
  }

  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Missing code');
    return;
  }

  try {
    const { access_token } = await exchangeCodeForToken(code);
    const userId = await fetchDiscordUserId(access_token);
    const sessionToken = createSessionToken(userId);
    res.writeHead(302, { Location: `discord-echo://auth?token=${sessionToken}` });
    res.end();
  } catch (err) {
    console.error('OAuth callback failed:', err);
    res.writeHead(302, { Location: `discord-echo://auth?error=callback_failed` });
    res.end();
  }
}
