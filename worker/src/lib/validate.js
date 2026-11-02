/**
 * Input validation. Every validator either returns a cleaned value or throws
 * HttpError(400, 'validation_failed', '<field>: <reason>').
 */

import { HttpError } from './http.js';
import { LIMITS } from './constants.js';

export const INSTRUMENT_ID_RE = /^[a-z0-9-]{2,120}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Deliberately simple: one @, no whitespace or brackets, a dot in the domain.
const EMAIL_RE = /^[^\s@<>()[\]",;:\\]+@[^\s@<>()[\]",;:\\]+\.[^\s@<>()[\]",;:\\]{2,}$/;
// C0/C1 control characters except tab and newline, plus bidi override chars
// that can make displayed text lie about its content.
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

function fail(field, reason) {
  return new HttpError(400, 'validation_failed', `${field}: ${reason}`);
}

function isAbsent(value) {
  return value === undefined || value === null || value === '';
}

/** Instrument id, e.g. "alternate-uses-task". */
export function instrumentId(value, { required = true, field = 'instrument_id' } = {}) {
  if (isAbsent(value)) {
    if (required) throw fail(field, 'is required');
    return null;
  }
  if (typeof value !== 'string' || !INSTRUMENT_ID_RE.test(value)) {
    throw fail(field, 'must match ^[a-z0-9-]{2,120}$');
  }
  return value;
}

/**
 * File path relative to the instrument folder, e.g. "materials/form A.pdf".
 * Unicode is allowed (real file names contain umlauts and spaces); path
 * traversal, absolute paths, backslashes and control characters are not.
 */
export function filePath(value, { required = false, field = 'file_path' } = {}) {
  if (isAbsent(value)) {
    if (required) throw fail(field, 'is required');
    return null;
  }
  if (typeof value !== 'string') throw fail(field, 'must be a string');
  const path = value.normalize('NFC');
  if (path.length > LIMITS.filePath.max) throw fail(field, `must be at most ${LIMITS.filePath.max} characters`);
  if (/[\u0000-\u001F\u007F\\]/.test(path)) throw fail(field, 'contains forbidden characters');
  const segments = path.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw fail(field, 'must be a relative path without empty, "." or ".." segments');
  }
  return path;
}

/** Enum value. */
export function oneOf(value, allowed, { required = true, field }) {
  if (isAbsent(value)) {
    if (required) throw fail(field, 'is required');
    return null;
  }
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw fail(field, `must be one of ${allowed.join(', ')}`);
  }
  return value;
}

/**
 * Free text: NFC-normalized, CRLF -> LF, control characters removed,
 * trimmed. singleLine collapses all whitespace runs into one space.
 */
export function text(value, { field, min = 0, max, required = false, singleLine = false }) {
  if (isAbsent(value)) {
    if (required) throw fail(field, 'is required');
    return null;
  }
  if (typeof value !== 'string') throw fail(field, 'must be a string');
  let s = value.normalize('NFC').replace(/\r\n?/g, '\n').replace(CONTROL_RE, '');
  s = singleLine ? s.replace(/\s+/g, ' ').trim() : s.trim();
  if (s === '') {
    if (required) throw fail(field, 'is required');
    return null;
  }
  if (s.length < min) throw fail(field, `must be at least ${min} characters`);
  if (max !== undefined && s.length > max) throw fail(field, `must be at most ${max} characters`);
  return s;
}

/** Email address (lower-cased domain is not enforced; stored as typed). */
export function email(value, { required = false, field = 'email' } = {}) {
  if (isAbsent(value)) {
    if (required) throw fail(field, 'is required');
    return null;
  }
  if (typeof value !== 'string') throw fail(field, 'must be a string');
  const s = value.trim();
  if (s.length > LIMITS.email.max || !EMAIL_RE.test(s)) throw fail(field, 'is not a valid email address');
  return s;
}

/** Opt-in visitor UUID (optional). */
export function optinId(value, { field = 'optin_id' } = {}) {
  if (isAbsent(value)) return null;
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw fail(field, 'must be a UUID');
  return value.toLowerCase();
}

/** Display name typed by a visitor; must not be an email address. */
export function personName(value, { required = false, field = 'name' } = {}) {
  const s = text(value, { field, min: LIMITS.name.min, max: LIMITS.name.max, required, singleLine: true });
  if (s && s.includes('@')) throw fail(field, 'must not contain an email address (it could be published)');
  return s;
}

/** Positive integer path/query parameter. */
export function positiveInt(value, { field }) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw fail(field, 'must be a positive integer');
  return n;
}
