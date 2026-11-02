/**
 * Admin authentication.
 *
 * Two ways in:
 *  1. Cloudflare Access (for humans in a browser). Put the admin routes or
 *     an admin hostname behind an Access application; Cloudflare then adds
 *     the header Cf-Access-Jwt-Assertion, an RS256 JWT that we verify
 *     against the team's JWKS at
 *       https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs
 *     checking signature, audience (ACCESS_AUD), issuer and expiry.
 *  2. Authorization: Bearer <ADMIN_TOKEN> (for scripts / cron exports).
 *     Compared in constant time. Disabled when ADMIN_TOKEN is unset.
 */

import { HttpError } from './http.js';
import { base64UrlDecode, safeStringEqual } from './crypto.js';

const JWKS_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_SEC = 60;

/** Per-isolate JWKS cache: teamOrigin -> {keys, fetchedAt}. */
const jwksCache = new Map();

/** "myteam.cloudflareaccess.com" or "https://myteam..." -> "https://myteam..." */
function teamOrigin(env) {
  let domain = String(env.ACCESS_TEAM_DOMAIN || '').trim().replace(/\/+$/, '');
  if (!domain) return null;
  if (!/^https:\/\//.test(domain)) domain = `https://${domain.replace(/^http:\/\//, '')}`;
  return domain;
}

async function fetchJwks(origin, forceRefresh) {
  const cached = jwksCache.get(origin);
  if (cached && !forceRefresh && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const res = await fetch(`${origin}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  const keys = Array.isArray(data.keys) ? data.keys : [];
  jwksCache.set(origin, { keys, fetchedAt: Date.now() });
  return keys;
}

function decodeJsonPart(part) {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(part)));
}

/**
 * Verify a Cloudflare Access JWT and return its claims. Throws on any
 * problem (the caller maps that to 401).
 */
export async function verifyAccessJwt(env, jwt, nowSec = Math.floor(Date.now() / 1000)) {
  const origin = teamOrigin(env);
  if (!origin || !env.ACCESS_AUD) throw new Error('Cloudflare Access is not configured');

  const parts = String(jwt).split('.');
  if (parts.length !== 3) throw new Error('malformed JWT');
  const header = decodeJsonPart(parts[0]);
  const claims = decodeJsonPart(parts[1]);
  if (header.alg !== 'RS256') throw new Error('unexpected JWT algorithm');

  let jwk = (await fetchJwks(origin, false)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await fetchJwks(origin, true)).find((k) => k.kid === header.kid); // key rotation
  if (!jwk) throw new Error('unknown JWT key id');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlDecode(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new Error('bad JWT signature');

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(env.ACCESS_AUD)) throw new Error('JWT audience mismatch');
  if (claims.iss !== origin) throw new Error('JWT issuer mismatch');
  if (typeof claims.exp !== 'number' || claims.exp < nowSec - CLOCK_SKEW_SEC) throw new Error('JWT expired');
  if (typeof claims.nbf === 'number' && claims.nbf > nowSec + CLOCK_SKEW_SEC) throw new Error('JWT not yet valid');
  return claims;
}

/**
 * Authenticate an admin request or throw 401.
 * @returns {Promise<{actor: string, method: 'token'|'access'}>}
 */
export async function requireAdmin(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
  if (bearer && env.ADMIN_TOKEN) {
    if (await safeStringEqual(bearer[1], env.ADMIN_TOKEN)) return { actor: 'admin-token', method: 'token' };
    throw new HttpError(401, 'unauthorized', 'Invalid admin token');
  }

  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (jwt) {
    try {
      const claims = await verifyAccessJwt(env, jwt);
      return { actor: String(claims.email || claims.sub || 'access-user'), method: 'access' };
    } catch (err) {
      console.warn('Access JWT rejected:', err.message);
      throw new HttpError(401, 'unauthorized', 'Invalid Cloudflare Access token');
    }
  }

  throw new HttpError(401, 'unauthorized', 'Admin authentication required', { 'WWW-Authenticate': 'Bearer' });
}
