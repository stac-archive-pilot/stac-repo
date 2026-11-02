/**
 * Pseudonymization.
 *
 * visitor_hash
 *   first 16 hex chars of HMAC-SHA256(PSEUDONYM_SECRET, day + "|" + ip + "|" + ua)
 *   where day is the current UTC date (YYYY-MM-DD). Because the day is part
 *   of the input, the same visitor gets an unrelated hash every day: it is
 *   good enough to count distinct visitors per day and to rate-limit, but it
 *   cannot be used to follow somebody across days. IP and user agent are
 *   only held in memory for the duration of the request.
 *
 * pseudonym (opt-in only)
 *   first 16 hex chars of HMAC-SHA256(PSEUDONYM_SECRET, "optin:" + optin_id)
 *   optin_id is a random UUID the visitor explicitly agreed to keep in their
 *   own browser storage. It gives a stable pseudonym across days, which the
 *   visitor can drop at any time by deleting the UUID.
 *
 * display name
 *   deterministic, human-friendly label derived from a 16-hex pseudonym,
 *   e.g. "curious-otter-3f9a". Not unique in theory (~50 million combos), but
 *   collisions are irrelevant at STAC's scale.
 */

import { hmacHex } from './crypto.js';

/** Daily-rotating visitor hash (16 hex chars). */
export async function visitorHash(secret, day, ip, userAgent) {
  const hex = await hmacHex(secret, `${day}|${ip || ''}|${userAgent || ''}`);
  return hex.slice(0, 16);
}

/** Stable opt-in pseudonym (16 hex chars). */
export async function optinPseudonym(secret, optinId) {
  const hex = await hmacHex(secret, `optin:${optinId.toLowerCase()}`);
  return hex.slice(0, 16);
}

const ADJECTIVES = [
  'agile', 'amber', 'bold', 'brave', 'bright', 'calm', 'clever', 'cosmic',
  'curious', 'daring', 'eager', 'gentle', 'golden', 'happy', 'humble', 'jolly',
  'keen', 'lively', 'lucky', 'mellow', 'merry', 'nimble', 'patient', 'playful',
  'quiet', 'quick', 'rapid', 'serene', 'sunny', 'swift', 'witty', 'zesty',
];

const ANIMALS = [
  'badger', 'beaver', 'bison', 'crane', 'dolphin', 'falcon', 'ferret', 'finch',
  'fox', 'gecko', 'heron', 'ibis', 'koala', 'lemur', 'lynx', 'marten',
  'moose', 'narwhal', 'newt', 'ocelot', 'otter', 'owl', 'panda', 'puffin',
  'quokka', 'raven', 'robin', 'seal', 'stoat', 'tapir', 'walrus', 'wombat',
];

/**
 * Deterministic display name from a 16-hex pseudonym or visitor hash.
 * Bytes 0-1 pick the adjective, bytes 2-3 the animal, bytes 4-5 are the
 * 4-hex suffix.
 */
export function displayName(hex16) {
  const adjective = ADJECTIVES[parseInt(hex16.slice(0, 4), 16) % ADJECTIVES.length];
  const animal = ANIMALS[parseInt(hex16.slice(4, 8), 16) % ANIMALS.length];
  return `${adjective}-${animal}-${hex16.slice(8, 12)}`;
}

/** Label for a visitor in the admin log. */
export function visitorLabel(visitorHashValue, pseudonymValue) {
  return pseudonymValue ? displayName(pseudonymValue) : `anon-${String(visitorHashValue).slice(0, 6)}`;
}
