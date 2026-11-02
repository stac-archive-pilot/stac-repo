/**
 * Cloudflare Turnstile server-side verification (siteverify).
 * Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

import { HttpError } from './http.js';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verify a Turnstile token or throw.
 *   503 not_configured       TURNSTILE_SECRET missing (fail closed)
 *   403 turnstile_failed     token missing/invalid/expired/reused
 *   502 turnstile_unavailable siteverify unreachable
 */
export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) {
    throw new HttpError(503, 'not_configured', 'Turnstile is not configured on the server');
  }
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    throw new HttpError(403, 'turnstile_failed', 'Missing or malformed turnstile_token');
  }

  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);

  let data;
  try {
    const res = await fetch(VERIFY_URL, { method: 'POST', body: form });
    data = await res.json();
  } catch {
    throw new HttpError(502, 'turnstile_unavailable', 'Could not reach the Turnstile verification service');
  }
  if (!data || data.success !== true) {
    throw new HttpError(403, 'turnstile_failed', 'Turnstile verification failed, please retry the challenge');
  }
  return data;
}
