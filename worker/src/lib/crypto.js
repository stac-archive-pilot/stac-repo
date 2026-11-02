/**
 * Small crypto helpers on top of WebCrypto (crypto.subtle), which is
 * available both in Cloudflare Workers and in Node 22.
 */

const encoder = new TextEncoder();

/** CryptoKey cache: importing a key is cheap but not free. */
const hmacKeyCache = new Map();

/** Import (and cache) an HMAC-SHA256 key from a secret string. */
async function hmacKey(secret) {
  let key = hmacKeyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ]);
    hmacKeyCache.set(secret, key);
  }
  return key;
}

/** HMAC-SHA256(secret, message) as bytes. */
export async function hmacBytes(secret, message) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return new Uint8Array(sig);
}

/** HMAC-SHA256(secret, message) as lowercase hex. */
export async function hmacHex(secret, message) {
  return toHex(await hmacBytes(secret, message));
}

/** Bytes to lowercase hex. */
export function toHex(bytes) {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Base64url-encode bytes or a (UTF-8) string, without padding. */
export function base64UrlEncode(input) {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode base64url to bytes. Throws on malformed input. */
export function base64UrlDecode(str) {
  if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new Error('invalid base64url');
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Constant-time comparison of two byte arrays. */
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Constant-time comparison of two strings of possibly different length:
 * both are HMACed with a random per-call key first, so the comparison is
 * over fixed-length digests and leaks neither content nor length.
 */
export async function safeStringEqual(a, b) {
  const nonce = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const [da, db] = await Promise.all([hmacBytes(nonce, String(a)), hmacBytes(nonce, String(b))]);
  return timingSafeEqual(da, db);
}

/** Alphabet without look-alikes (no 0/O, 1/I). 32 symbols -> unbiased. */
const TICKET_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Random human-friendly ticket id, e.g. "STAC-K7Q2MX". */
export function randomTicket() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = '';
  for (const b of bytes) out += TICKET_ALPHABET[b & 31];
  return `STAC-${out}`;
}
