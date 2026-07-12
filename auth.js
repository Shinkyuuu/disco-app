import crypto from 'node:crypto';

const SESSION_TOKEN_TTL_MS = 6 * 30 * 24 * 60 * 60 * 1000; // 6 months
const EXCHANGE_CODE_TTL_MS = 60 * 1000; // 60s - just long enough for the OS to launch the disco:// link and the app to redeem it
const STATE_COOKIE_NAME = 'disco_oauth_state';
const STATE_COOKIE_MAX_AGE_S = 300; // 5 minutes - generous for a slow OAuth consent screen

// Sessions are self-verifying (payload + HMAC signature), not looked up in any server-side
// store - a restart must never log users out, and there's nothing here to lose on restart.
// Trades away the ability to revoke one specific session early (it just expires at the TTL
// instead), which logout() doesn't do today anyway, so this isn't a regression.
const { SESSION_SECRET } = process.env;
if (!SESSION_SECRET) {
  throw new Error('SESSION_SECRET env var is required to sign session tokens');
}

function signPayload(payloadB64) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payloadB64).digest('base64url');
}

export function createSessionToken(userId) {
  const expiresAt = Date.now() + SESSION_TOKEN_TTL_MS;
  const payloadB64 = Buffer.from(JSON.stringify({ userId, expiresAt })).toString('base64url');
  return `${payloadB64}.${signPayload(payloadB64)}`;
}

export function verifySessionToken(token) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payloadB64 = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expectedSignature = signPayload(payloadB64);
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  // Different-length buffers would make timingSafeEqual throw rather than return false.
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.userId !== 'string' || typeof payload.expiresAt !== 'number') return null;
  if (Date.now() >= payload.expiresAt) return null;
  return payload.userId;
}

// code -> { userId, expiresAt }. A single-use, short-lived hand-off between the
// OAuth callback (a browser redirect - an unavoidably observable context, e.g.
// proxy access logs) and the Electron app's POST /auth/exchange call (body, not
// a URL) - the long-lived bearer session token itself never appears in a URL
// anywhere in this flow, so a logged/observed redirect can't leak it.
const exchangeCodes = new Map();

export function createExchangeCode(userId) {
  const code = crypto.randomBytes(32).toString('hex');
  exchangeCodes.set(code, { userId, expiresAt: Date.now() + EXCHANGE_CODE_TTL_MS });
  return code;
}

export function redeemExchangeCode(code) {
  const entry = exchangeCodes.get(code);
  exchangeCodes.delete(code); // single-use regardless of outcome
  if (!entry || Date.now() >= entry.expiresAt) return null;
  return entry.userId;
}

const { DISCORD_APPLICATION_ID, DISCORD_CLIENT_SECRET } = process.env;
const PORT_NUMBER = process.env.PORT || 3000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT_NUMBER}`;
const REDIRECT_URI = `${PUBLIC_BASE_URL}/auth/callback`;

export function buildAuthorizeUrl(state) {
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', DISCORD_APPLICATION_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  return url.toString();
}

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function handleAuthLogin(req, res) {
  const state = crypto.randomBytes(16).toString('hex');
  res.writeHead(302, {
    Location: buildAuthorizeUrl(state),
    // HttpOnly, short-lived double-submit cookie: binds this login attempt's
    // browser to the callback that completes it, so a forged callback request
    // carrying a `code` the attacker (not the user) obtained gets rejected -
    // the classic OAuth login-CSRF hole. SameSite=Lax (not Strict) because this
    // cookie must still be attached to Discord's own top-level GET redirect
    // back to /auth/callback.
    'Set-Cookie': `${STATE_COOKIE_NAME}=${state}; HttpOnly; Max-Age=${STATE_COOKIE_MAX_AGE_S}; SameSite=Lax; Path=/auth/callback`,
  });
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
  // One-shot: clear the state cookie on every outcome below, success or not.
  const clearStateCookie = `${STATE_COOKIE_NAME}=; HttpOnly; Max-Age=0; SameSite=Lax; Path=/auth/callback`;

  // Discord redirects here with ?error=access_denied (standard OAuth2 behavior) when the
  // user declines on the consent screen - forward it through the same deep-link mechanism
  // as a success, carrying an error instead of a token, so the Electron app can show a
  // real in-app retry state instead of leaving the user stuck on a bare browser page.
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    res.writeHead(302, {
      Location: `disco://auth?error=${encodeURIComponent(oauthError)}`,
      'Set-Cookie': clearStateCookie,
    });
    res.end();
    return;
  }

  const expectedState = parseCookie(req.headers.cookie, STATE_COOKIE_NAME);
  const actualState = url.searchParams.get('state');
  if (!expectedState || expectedState !== actualState) {
    res.writeHead(302, { Location: 'disco://auth?error=invalid_state', 'Set-Cookie': clearStateCookie });
    res.end();
    return;
  }

  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/plain', 'Set-Cookie': clearStateCookie });
    res.end('Missing code');
    return;
  }

  try {
    const { access_token } = await exchangeCodeForToken(code);
    const userId = await fetchDiscordUserId(access_token);
    // Hand the browser a short-lived, single-use exchange code - not the real
    // session token - so the token itself never travels in a URL. See
    // createExchangeCode's comment for why.
    const exchangeCode = createExchangeCode(userId);
    res.writeHead(302, {
      Location: `disco://auth?code=${exchangeCode}`,
      'Set-Cookie': clearStateCookie,
    });
    res.end();
  } catch (err) {
    console.error('OAuth callback failed:', err);
    res.writeHead(302, { Location: 'disco://auth?error=callback_failed', 'Set-Cookie': clearStateCookie });
    res.end();
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('error', reject);
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Redeems the one-time code minted by handleAuthCallback for the actual
// long-lived bearer session token, over a POST body instead of a URL.
export async function handleAuthExchange(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'method not allowed' }));
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid body' }));
    return;
  }

  const userId = typeof body.code === 'string' ? redeemExchangeCode(body.code) : null;
  if (!userId) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid or expired code' }));
    return;
  }

  const token = createSessionToken(userId);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ token, userId }));
}
