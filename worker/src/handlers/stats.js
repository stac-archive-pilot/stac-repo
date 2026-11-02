/**
 * GET /v1/stats/summary
 * GET /v1/stats/instrument/:id
 *
 * Cached for STATS_CACHE_SECONDS (default 300) in three layers:
 *   1. a small per-isolate memo (works everywhere, also on workers.dev)
 *   2. the Cloudflare Cache API (per data center; effective on custom domains)
 *   3. Cache-Control: public, max-age=... for browsers/CDNs
 * Set STATS_CACHE_SECONDS=0 to disable caching (used by the tests).
 *
 * Cached responses are stored WITHOUT CORS headers; the router adds the
 * caller's own Access-Control-Allow-Origin on the way out.
 */

import { json } from '../lib/http.js';
import { DEFAULT_STATS_CACHE_SECONDS } from '../lib/constants.js';
import { buildStats } from '../lib/db.js';
import * as v from '../lib/validate.js';
import { requireEnv } from './common.js';

const memo = new Map();
const MEMO_MAX_ENTRIES = 500;

function cacheSeconds(env) {
  const n = Number.parseInt(env.STATS_CACHE_SECONDS ?? DEFAULT_STATS_CACHE_SECONDS, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_STATS_CACHE_SECONDS;
}

async function cachedJson({ request, env, ctx }, keyPath, build) {
  const ttl = cacheSeconds(env);
  if (ttl === 0) return json(await build(), 200, { 'Cache-Control': 'no-store' });

  const headers = { 'Cache-Control': `public, max-age=${ttl}` };
  const now = Date.now();
  const hit = memo.get(keyPath);
  if (hit && hit.expires > now) return json(hit.data, 200, headers);

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheKey = new Request(new URL(keyPath, request.url).toString(), { method: 'GET' });
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  const data = await build();
  if (memo.size >= MEMO_MAX_ENTRIES) memo.clear();
  memo.set(keyPath, { data, expires: now + ttl * 1000 });
  const response = json(data, 200, headers);
  if (cache) ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

export async function handleStatsSummary(c) {
  const db = requireEnv(c.env, 'DB');
  return cachedJson(c, '/v1/stats/summary', () => buildStats(db, null));
}

export async function handleStatsInstrument(c) {
  const db = requireEnv(c.env, 'DB');
  const id = v.instrumentId(c.params[0]);
  return cachedJson(c, `/v1/stats/instrument/${id}`, () => buildStats(db, id));
}
