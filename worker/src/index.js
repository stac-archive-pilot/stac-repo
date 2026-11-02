/**
 * STAC API: Cloudflare Worker entry point.
 *
 * Small serverless backend for the STAC archive's static GitHub Pages site.
 * It provides what GitHub cannot: long-term view/download counters,
 * messages and access requests from people without a GitHub account,
 * moderated public messages, signed links for restricted files, and a
 * pseudonymized activity log for admins.
 *
 * Bindings (see wrangler.toml and README.md):
 *   DB          D1 database (schema.sql)
 *   RESTRICTED  R2 bucket with restricted files, key "<instrument_id>/<file_path>" (optional)
 * Secrets: PSEUDONYM_SECRET, TURNSTILE_SECRET, GITHUB_TOKEN, ADMIN_TOKEN, ...
 *
 * Every response is JSON (except downloads and CSV exports); errors are
 * always {error: {code, message}}.
 */

import { HttpError, errorResponse, finalizeResponse, json } from './lib/http.js';
import { corsHeaders, evaluateOrigin, preflightResponse } from './lib/cors.js';
import { requireAdmin } from './lib/access-jwt.js';
import { runMaintenance } from './lib/db.js';
import { DEFAULT_RAW_RETENTION_DAYS } from './lib/constants.js';
import { intEnv } from './handlers/common.js';
import { handleEvent } from './handlers/events.js';
import { handleStatsInstrument, handleStatsSummary } from './handlers/stats.js';
import { handleBoard, handleCreateMessage } from './handlers/messages.js';
import { handleCreateAccessRequest, handleDownload } from './handlers/access.js';
import {
  handleAdminApproveAccess,
  handleAdminDenyAccess,
  handleAdminListAccessRequests,
  handleAdminListMessages,
  handleAdminLog,
  handleAdminModerateMessage,
} from './handlers/admin.js';

/** GET /v1/health */
async function handleHealth({ env }) {
  let db = 'unbound';
  if (env.DB) {
    try {
      await env.DB.prepare('SELECT 1 AS ok').first();
      db = 'ok';
    } catch {
      db = 'error';
    }
  }
  return json({
    ok: db === 'ok',
    service: 'stac-api',
    api_version: 'v1',
    time: new Date().toISOString(),
    checks: { db, r2: env.RESTRICTED ? 'bound' : 'unbound' },
  });
}

/** Wrap a handler so it only runs for authenticated admins. */
const admin = (handler) => async (c) => handler({ ...c, admin: await requireAdmin(c.request, c.env) });

/** Route table: [method, path regex, handler]. Capture groups become c.params. */
const ROUTES = [
  ['GET', /^\/v1\/health$/, handleHealth],
  ['POST', /^\/v1\/events$/, handleEvent],
  ['GET', /^\/v1\/stats\/summary$/, handleStatsSummary],
  ['GET', /^\/v1\/stats\/instrument\/([^/]+)$/, handleStatsInstrument],
  ['POST', /^\/v1\/messages$/, handleCreateMessage],
  ['GET', /^\/v1\/board$/, handleBoard],
  ['POST', /^\/v1\/access-requests$/, handleCreateAccessRequest],
  ['GET', /^\/v1\/download\/([^/]+)$/, handleDownload],
  ['GET', /^\/v1\/admin\/log$/, admin(handleAdminLog)],
  ['GET', /^\/v1\/admin\/messages$/, admin(handleAdminListMessages)],
  ['POST', /^\/v1\/admin\/messages\/(\d+)\/(approve|reject)$/, admin(handleAdminModerateMessage)],
  ['GET', /^\/v1\/admin\/access-requests$/, admin(handleAdminListAccessRequests)],
  ['POST', /^\/v1\/admin\/access-requests\/(\d+)\/approve$/, admin(handleAdminApproveAccess)],
  ['POST', /^\/v1\/admin\/access-requests\/(\d+)\/deny$/, admin(handleAdminDenyAccess)],
];

function decodeParam(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, 'bad_request', 'Malformed URL encoding');
  }
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const allowedMethods = [];

  for (const [method, pattern, handler] of ROUTES) {
    const match = pattern.exec(path);
    if (!match) continue;
    if (method !== request.method) {
      allowedMethods.push(method);
      continue;
    }
    const params = match.slice(1).map(decodeParam);
    return handler({ request, env, ctx, url, params });
  }

  if (allowedMethods.length) {
    throw new HttpError(405, 'method_not_allowed', `Use ${allowedMethods.join(' or ')}`, {
      Allow: [...allowedMethods, 'OPTIONS'].join(', '),
    });
  }
  throw new HttpError(404, 'not_found', 'No such endpoint');
}

function toErrorResponse(err) {
  if (err instanceof HttpError) return errorResponse(err.status, err.code, err.message, err.headers);
  console.error('Unhandled error:', err?.stack || err);
  return errorResponse(500, 'internal', 'Internal server error');
}

export default {
  /** HTTP entry point. */
  async fetch(request, env, ctx) {
    const { origin, allowed } = evaluateOrigin(request, env);
    let response;
    try {
      if (!allowed) throw new HttpError(403, 'forbidden_origin', 'Origin not allowed');
      response = request.method === 'OPTIONS' ? preflightResponse() : await route(request, env, ctx);
    } catch (err) {
      response = toErrorResponse(err);
    }
    return finalizeResponse(response, allowed && origin ? corsHeaders(origin) : {});
  },

  /** Cron entry point ("17 3 * * *"): aggregate, then purge. */
  async scheduled(controller, env, ctx) {
    const retentionDays = intEnv(env, 'RAW_RETENTION_DAYS', DEFAULT_RAW_RETENTION_DAYS);
    const now = controller?.scheduledTime ? new Date(controller.scheduledTime) : new Date();
    const summary = await runMaintenance(env.DB, { retentionDays, now });
    console.log('Maintenance done:', JSON.stringify(summary));
    return summary;
  },
};
