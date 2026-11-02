/**
 * CORS: only origins listed in env.ALLOWED_ORIGINS (comma-separated, exact
 * match including scheme and port) may call the API from a browser.
 *
 * Requests WITHOUT an Origin header (curl, server-side scripts, top-level
 * navigation to a download link) are not browser cross-origin requests and
 * are let through; CORS cannot restrict those anyway. Admin routes are
 * protected by authentication, public write routes by Turnstile and rate
 * limits.
 */

/** Parse ALLOWED_ORIGINS into a Set of normalized origins. */
export function allowedOrigins(env) {
  return new Set(
    String(env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  );
}

/**
 * Decide whether the request's origin is acceptable.
 * @returns {{origin: string|null, allowed: boolean}}
 */
export function evaluateOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return { origin: null, allowed: true };
  return { origin, allowed: allowedOrigins(env).has(origin) };
}

/** Headers that grant the (already validated) origin access. */
export function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Expose-Headers': 'Retry-After, X-Truncated',
  };
}

/** Answer a preflight request from an allowed origin. */
export function preflightResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}
