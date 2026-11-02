/**
 * Signed, time-limited download tokens for restricted materials.
 *
 * Format:  base64url(JSON payload) "." base64url(HMAC-SHA256(secret, payload part))
 * Payload: {v: 1, r: <access request id>, k: <R2 key "instrument_id/file_path">, e: <expiry, unix seconds>}
 *
 * The signing secret is DOWNLOAD_TOKEN_SECRET if set, otherwise a key derived
 * from PSEUDONYM_SECRET with a fixed domain-separation label (so the same
 * secret is never used for two purposes directly).
 *
 * A valid signature is necessary but not sufficient: the download handler
 * also checks that the access request is still 'approved' and that the key
 * matches the approved file, which makes "deny" an effective revocation.
 */

import { HttpError } from './http.js';
import { base64UrlDecode, base64UrlEncode, hmacBytes, hmacHex, timingSafeEqual } from './crypto.js';

async function signingSecret(env) {
  if (env.DOWNLOAD_TOKEN_SECRET) return env.DOWNLOAD_TOKEN_SECRET;
  if (!env.PSEUDONYM_SECRET) throw new HttpError(503, 'not_configured', 'Token signing secret is not configured');
  return `derived:${await hmacHex(env.PSEUDONYM_SECRET, 'stac-download-token-v1')}`;
}

/**
 * @param {object} env
 * @param {{requestId: number, key: string, expiresAt: number}} claims expiresAt in unix seconds
 */
export async function signDownloadToken(env, { requestId, key, expiresAt }) {
  const payload = base64UrlEncode(JSON.stringify({ v: 1, r: requestId, k: key, e: expiresAt }));
  const signature = base64UrlEncode(await hmacBytes(await signingSecret(env), payload));
  return `${payload}.${signature}`;
}

/**
 * Verify signature and expiry.
 *   403 invalid_token  malformed or tampered
 *   410 token_expired  signature fine but past expiry
 * @returns {Promise<{v: number, r: number, k: string, e: number}>}
 */
export async function verifyDownloadToken(env, token, nowSec = Math.floor(Date.now() / 1000)) {
  const invalid = () => new HttpError(403, 'invalid_token', 'Download link is invalid');
  if (typeof token !== 'string' || token.length > 2048) throw invalid();
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw invalid();

  let provided;
  try {
    provided = base64UrlDecode(parts[1]);
  } catch {
    throw invalid();
  }
  const expected = await hmacBytes(await signingSecret(env), parts[0]);
  if (!timingSafeEqual(provided, expected)) throw invalid();

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
  } catch {
    throw invalid();
  }
  if (
    payload?.v !== 1 ||
    !Number.isSafeInteger(payload.r) ||
    typeof payload.k !== 'string' ||
    !Number.isSafeInteger(payload.e)
  ) {
    throw invalid();
  }
  if (payload.e < nowSec) throw new HttpError(410, 'token_expired', 'Download link has expired, please request access again');
  return payload;
}
