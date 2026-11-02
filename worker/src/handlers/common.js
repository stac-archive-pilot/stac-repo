/**
 * Helpers shared by several handlers.
 */

import { HttpError, clientIp } from '../lib/http.js';
import { optinPseudonym, visitorHash } from '../lib/pseudonym.js';
import { utcDay } from '../lib/time.js';
import { randomTicket } from '../lib/crypto.js';

/** Fail with 503 when a required binding or secret is missing. */
export function requireEnv(env, name) {
  if (!env[name]) throw new HttpError(503, 'not_configured', `Server is missing configuration: ${name}`);
  return env[name];
}

/**
 * Derive the request's pseudonymous visitor identity.
 * IP and User-Agent are read here, hashed, and dropped.
 *
 * @returns {Promise<{ts: string, day: string, visitorHash: string, pseudonym: string|null, ip: string}>}
 *          `ip` is returned only so Turnstile can receive it; never store it.
 */
export async function visitorContext(request, env, optinId = null, now = new Date()) {
  const secret = requireEnv(env, 'PSEUDONYM_SECRET');
  const day = utcDay(now);
  const ip = clientIp(request);
  const ua = request.headers.get('User-Agent') || '';
  return {
    ts: now.toISOString(),
    day,
    ip,
    visitorHash: await visitorHash(secret, day, ip, ua),
    pseudonym: optinId ? await optinPseudonym(secret, optinId) : null,
  };
}

/**
 * Insert a row that carries a random ticket, retrying on the (astronomically
 * unlikely) ticket collision. `build(ticket)` must return a prepared
 * statement ending in "RETURNING id".
 * @returns {Promise<{id: number, ticket: string}>}
 */
export async function insertWithTicket(build) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ticket = randomTicket();
    try {
      const id = await build(ticket).first('id');
      return { id, ticket };
    } catch (err) {
      if (!/UNIQUE/i.test(String(err?.message)) || attempt === 2) throw err;
    }
  }
  throw new Error('unreachable');
}

/** Read a positive integer env var with a default. */
export function intEnv(env, name, fallback) {
  const n = Number.parseInt(env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Public base URL of this API (for links handed out by admin routes). */
export function apiBase(request, env) {
  return String(env.PUBLIC_API_BASE || new URL(request.url).origin).replace(/\/+$/, '');
}
