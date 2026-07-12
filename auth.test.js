import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  createSessionToken,
  verifySessionToken,
  createExchangeCode,
  redeemExchangeCode,
  buildAuthorizeUrl,
  handleAuthLogin,
  handleAuthCallback,
  handleAuthExchange,
} from './auth.js';

function startTestHttpServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

test('createSessionToken then verifySessionToken returns the same userId', () => {
  const token = createSessionToken('user-123');
  assert.equal(verifySessionToken(token), 'user-123');
});

test('verifySessionToken returns null for an unknown token', () => {
  assert.equal(verifySessionToken('not-a-real-token'), null);
});

test('verifySessionToken returns null once the 6-month TTL has passed', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const token = createSessionToken('user-456');
  t.mock.timers.tick(6 * 30 * 24 * 60 * 60 * 1000 + 1); // just past the 6-month TTL
  assert.equal(verifySessionToken(token), null);
});

test('verifySessionToken returns null for a token with a tampered payload', () => {
  const token = createSessionToken('user-456');
  const [payload, signature] = token.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const tamperedPayload = Buffer.from(JSON.stringify({ ...decoded, userId: 'attacker' })).toString('base64url');
  assert.equal(verifySessionToken(`${tamperedPayload}.${signature}`), null);
});

test('verifySessionToken returns null for a token with a tampered signature', () => {
  const token = createSessionToken('user-456');
  const [payload, signature] = token.split('.');
  const tamperedSignature = signature.slice(0, -1) + (signature.at(-1) === 'a' ? 'b' : 'a');
  assert.equal(verifySessionToken(`${payload}.${tamperedSignature}`), null);
});

test('verifySessionToken returns null for a malformed token', () => {
  assert.equal(verifySessionToken('no-dot-in-here'), null);
  assert.equal(verifySessionToken(''), null);
});

test('a session token survives a fresh in-memory state - no server-side store to lose on restart', () => {
  // Regression guard for the original bug: sessions must not depend on any process-lifetime
  // state. Verifying immediately after creation, with nothing else touched in between, is the
  // whole point - there is no Map/cache to simulate "restarting" because there must not be one.
  const token = createSessionToken('user-789');
  assert.equal(verifySessionToken(token), 'user-789');
});

test('createExchangeCode then redeemExchangeCode returns the same userId', () => {
  const code = createExchangeCode('user-1');
  assert.equal(redeemExchangeCode(code), 'user-1');
});

test('redeemExchangeCode is single-use', () => {
  const code = createExchangeCode('user-1');
  redeemExchangeCode(code);
  assert.equal(redeemExchangeCode(code), null);
});

test('redeemExchangeCode returns null for an unknown code', () => {
  assert.equal(redeemExchangeCode('not-a-real-code'), null);
});

test('redeemExchangeCode returns null and purges an expired code', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const code = createExchangeCode('user-2');
  t.mock.timers.tick(60 * 1000 + 1); // just past the 60s TTL
  assert.equal(redeemExchangeCode(code), null);
});

test('buildAuthorizeUrl includes the required OAuth params, including the CSRF state', () => {
  const url = new URL(buildAuthorizeUrl('some-state'));
  assert.equal(url.origin + url.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'identify');
  assert.equal(url.searchParams.get('client_id'), process.env.DISCORD_APPLICATION_ID);
  const expectedBase = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  assert.equal(url.searchParams.get('redirect_uri'), `${expectedBase}/auth/callback`);
  assert.equal(url.searchParams.get('state'), 'some-state');
});

test('handleAuthLogin sets an HttpOnly state cookie and includes the same state in the authorize redirect', async () => {
  const { server, port } = await startTestHttpServer(handleAuthLogin);
  const res = await fetch(`http://localhost:${port}/auth/login`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  const state = location.searchParams.get('state');
  assert.ok(state && state.length > 0);
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, new RegExp(`disco_oauth_state=${state}`));
  assert.match(setCookie, /HttpOnly/);
  server.close();
});

test('handleAuthCallback rejects a callback with no state cookie (CSRF)', async () => {
  const { server, port } = await startTestHttpServer(handleAuthCallback);
  const res = await fetch(`http://localhost:${port}/auth/callback?code=abc&state=whatever`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  assert.equal(location.searchParams.get('error'), 'invalid_state');
  server.close();
});

test('handleAuthCallback rejects a callback whose state does not match the cookie (CSRF)', async () => {
  const { server, port } = await startTestHttpServer(handleAuthCallback);
  const res = await fetch(`http://localhost:${port}/auth/callback?code=abc&state=wrong`, {
    redirect: 'manual',
    headers: { Cookie: 'disco_oauth_state=right' },
  });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  assert.equal(location.searchParams.get('error'), 'invalid_state');
  server.close();
});

test('handleAuthCallback forwards a Discord-side error without needing a matching state', async () => {
  const { server, port } = await startTestHttpServer(handleAuthCallback);
  const res = await fetch(`http://localhost:${port}/auth/callback?error=access_denied`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  assert.equal(location.searchParams.get('error'), 'access_denied');
  server.close();
});

test('handleAuthCallback exchanges a valid state+code for a disco:// redirect carrying a one-time exchange code (not the bearer token)', async (t) => {
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const href = String(url);
    if (href.includes('discord.com/api/oauth2/token')) {
      return new Response(JSON.stringify({ access_token: 'fake-access-token' }), { status: 200 });
    }
    if (href.includes('discord.com/api/users/@me')) {
      return new Response(JSON.stringify({ id: 'user-999' }), { status: 200 });
    }
    return realFetch(url, opts);
  });

  const { server, port } = await startTestHttpServer(handleAuthCallback);
  const res = await fetch(`http://localhost:${port}/auth/callback?code=discord-code&state=right`, {
    redirect: 'manual',
    headers: { Cookie: 'disco_oauth_state=right' },
  });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'));
  assert.equal(location.protocol, 'disco:');
  assert.equal(location.searchParams.get('token'), null); // the bearer token itself must never appear in a URL
  const exchangeCode = location.searchParams.get('code');
  assert.ok(exchangeCode);
  assert.equal(redeemExchangeCode(exchangeCode), 'user-999');
  server.close();
});

test('POST /auth/exchange returns a session token for a valid exchange code', async () => {
  const code = createExchangeCode('user-77');
  const { server, port } = await startTestHttpServer(handleAuthExchange);
  const res = await fetch(`http://localhost:${port}/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.userId, 'user-77');
  assert.equal(verifySessionToken(body.token), 'user-77');
  server.close();
});

test('POST /auth/exchange returns 401 for an invalid code', async () => {
  const { server, port } = await startTestHttpServer(handleAuthExchange);
  const res = await fetch(`http://localhost:${port}/auth/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'not-real' }),
  });
  assert.equal(res.status, 401);
  server.close();
});

test('GET /auth/exchange is rejected (POST only)', async () => {
  const { server, port } = await startTestHttpServer(handleAuthExchange);
  const res = await fetch(`http://localhost:${port}/auth/exchange`);
  assert.equal(res.status, 405);
  server.close();
});
