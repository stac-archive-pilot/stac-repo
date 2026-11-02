/**
 * HTTP helpers: JSON responses, the consistent error format
 * {error: {code, message}}, size-limited body parsing and security headers.
 */

/** Throw this from any handler; the router turns it into a JSON error. */
export class HttpError extends Error {
  /**
   * @param {number} status  HTTP status code
   * @param {string} code    machine-readable error code (snake_case)
   * @param {string} message human-readable explanation
   * @param {Record<string,string>} [headers] extra response headers
   */
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

/** Build a JSON response. */
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

/** 204 No Content. */
export function noContent(headers = {}) {
  return new Response(null, { status: 204, headers });
}

/** Build an error response in the standard shape. */
export function errorResponse(status, code, message, headers = {}) {
  return json({ error: { code, message } }, status, headers);
}

/** Headers added to every response unless a handler already set them. */
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'interest-cohort=()',
};

/**
 * Copy a response and add security headers, Vary and (optionally) CORS
 * headers. Responses from the Cache API have immutable headers, so we always
 * rebuild the Response object.
 */
export function finalizeResponse(response, extraHeaders = {}) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  headers.set('Vary', 'Origin');
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Read the request body as text, refusing anything larger than maxBytes.
 * Reads the stream chunk by chunk so a huge body is never buffered in full.
 */
export async function readBodyText(request, maxBytes) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, 'payload_too_large', `Request body exceeds ${maxBytes} bytes`);
  }
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, 'payload_too_large', `Request body exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buffer);
}

/**
 * Parse a JSON object body.
 *
 * @param {Request} request
 * @param {object} opts
 * @param {number} opts.maxBytes        size limit
 * @param {boolean} [opts.allowTextPlain] accept text/plain (navigator.sendBeacon
 *        sends strings as text/plain, which also avoids a CORS preflight)
 * @param {boolean} [opts.optional]     an empty body yields {}
 */
export async function readJsonBody(request, { maxBytes, allowTextPlain = false, optional = false }) {
  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const text = await readBodyText(request, maxBytes);
  if (optional && text.trim() === '') return {};

  const typeOk =
    contentType === 'application/json' ||
    (allowTextPlain && (contentType === 'text/plain' || contentType === ''));
  if (!typeOk) {
    throw new HttpError(
      415,
      'unsupported_media_type',
      allowTextPlain ? 'Use Content-Type application/json or text/plain' : 'Use Content-Type application/json',
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpError(400, 'invalid_json', 'Request body must be a JSON object');
  }
  return data;
}

/**
 * Client IP as seen by Cloudflare. Only used transiently to derive the daily
 * visitor hash and for Turnstile; it is never stored. X-Forwarded-For is
 * deliberately ignored because clients can spoof it.
 */
export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || '';
}
