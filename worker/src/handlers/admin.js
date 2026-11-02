/**
 * Admin routes. Every handler here is wrapped by the router with
 * requireAdmin(), so `admin` = {actor, method} is always present.
 *
 *   GET  /v1/admin/log?since=&until=&type=&instrument_id=&limit=&format=json|csv
 *   GET  /v1/admin/messages?status=
 *   POST /v1/admin/messages/:id/approve | reject      body {note?, publish_discussion?}
 *   GET  /v1/admin/access-requests?status=
 *   POST /v1/admin/access-requests/:id/approve        body {file_path?, note?}
 *   POST /v1/admin/access-requests/:id/deny           body {note?}
 */

import { HttpError, json, readJsonBody } from '../lib/http.js';
import { DEFAULT_DOWNLOAD_TTL_DAYS, EVENT_TYPES, LIMITS, MAX_BODY } from '../lib/constants.js';
import * as v from '../lib/validate.js';
import { visitorLabel } from '../lib/pseudonym.js';
import { addDays, isDay } from '../lib/time.js';
import { blockquote, createDiscussion, discussionsConfigured, escapeInline } from '../lib/github.js';
import { signDownloadToken } from '../lib/tokens.js';
import { apiBase, intEnv, requireEnv } from './common.js';

// ---------------------------------------------------------------------------
// Activity log ("Protokoll")
// ---------------------------------------------------------------------------

/** Parse a since/until bound: YYYY-MM-DD or a full ISO timestamp. */
function parseBound(value, field, isUpper) {
  if (!value) return null;
  if (isDay(value)) {
    // A bare day as upper bound means "through the end of that day".
    return isUpper ? { op: '<', value: `${addDays(value, 1)}T00:00:00.000Z` } : { op: '>=', value: `${value}T00:00:00.000Z` };
  }
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) {
    throw new HttpError(400, 'validation_failed', `${field}: must be YYYY-MM-DD or an ISO 8601 timestamp`);
  }
  return { op: isUpper ? '<=' : '>=', value: t.toISOString() };
}

/** Quote a CSV cell; neutralize spreadsheet formula injection. */
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function handleAdminLog({ env, url }) {
  const db = requireEnv(env, 'DB');
  const q = url.searchParams;
  const since = parseBound(q.get('since'), 'since', false);
  const until = parseBound(q.get('until'), 'until', true);
  const type = v.oneOf(q.get('type'), EVENT_TYPES, { required: false, field: 'type' });
  const instrumentId = v.instrumentId(q.get('instrument_id'), { required: false });
  const format = v.oneOf(q.get('format'), ['json', 'csv'], { required: false, field: 'format' }) || 'json';
  const limit = q.get('limit') ? Math.min(v.positiveInt(q.get('limit'), { field: 'limit' }), 50000) : 5000;

  const where = [];
  const binds = [];
  if (since) { where.push(`ts ${since.op} ?`); binds.push(since.value); }
  if (until) { where.push(`ts ${until.op} ?`); binds.push(until.value); }
  if (type) { where.push('type = ?'); binds.push(type); }
  if (instrumentId) { where.push('instrument_id = ?'); binds.push(instrumentId); }
  binds.push(limit + 1); // one extra row tells us whether the result was truncated

  const { results } = await db
    .prepare(
      `SELECT ts, type, instrument_id, file_path, visitor_hash, pseudonym FROM events
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ts DESC, id DESC LIMIT ?`,
    )
    .bind(...binds)
    .all();

  const truncated = results.length > limit;
  const rows = results.slice(0, limit).map((r) => ({
    ts: r.ts,
    type: r.type,
    instrument_id: r.instrument_id,
    file_path: r.file_path || null,
    visitor: visitorLabel(r.visitor_hash, r.pseudonym),
  }));
  const extra = { 'X-Truncated': String(truncated) };

  if (format === 'csv') {
    const columns = ['ts', 'type', 'instrument_id', 'file_path', 'visitor'];
    const lines = [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))];
    return new Response(`${lines.join('\r\n')}\r\n`, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="stac-log-${new Date().toISOString().slice(0, 10)}.csv"`,
        ...extra,
      },
    });
  }
  return json(rows, 200, extra);
}

// ---------------------------------------------------------------------------
// Message moderation
// ---------------------------------------------------------------------------

const MESSAGE_STATUSES = ['pending', 'approved', 'rejected', 'stored', 'forwarded', 'forward_failed'];

export async function handleAdminListMessages({ env, url }) {
  const db = requireEnv(env, 'DB');
  const status = v.oneOf(url.searchParams.get('status'), MESSAGE_STATUSES, { required: false, field: 'status' });
  const { results } = await db
    .prepare(
      `SELECT id, ticket, created_at, kind, visibility, status, instrument_id, subject, body, name, email,
              author_display, github_issue_url, discussion_url, moderated_at, moderated_by, moderation_note
       FROM messages WHERE (?1 IS NULL OR status = ?1)
       ORDER BY created_at DESC, id DESC LIMIT 500`,
    )
    .bind(status)
    .all();
  return json(results);
}

export async function handleAdminModerateMessage({ request, env, params, admin }) {
  const db = requireEnv(env, 'DB');
  const id = v.positiveInt(params[0], { field: 'id' });
  const action = params[1]; // 'approve' | 'reject' (guaranteed by the route regex)
  const body = await readJsonBody(request, { maxBytes: MAX_BODY.admin, optional: true });
  const note = v.text(body.note, { field: 'note', max: LIMITS.note.max });

  const msg = await db.prepare(`SELECT * FROM messages WHERE id = ?1`).bind(id).first();
  if (!msg) throw new HttpError(404, 'not_found', 'Message not found');
  if (msg.visibility !== 'public') {
    throw new HttpError(409, 'not_moderatable', 'Only public messages are moderated');
  }
  const allowedFrom = action === 'approve' ? ['pending', 'rejected'] : ['pending', 'approved'];
  if (!allowedFrom.includes(msg.status)) {
    throw new HttpError(409, 'conflict', `Cannot ${action} a message with status '${msg.status}'`);
  }

  const now = new Date().toISOString();
  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  await db
    .prepare(`UPDATE messages SET status = ?1, moderated_at = ?2, moderated_by = ?3, moderation_note = ?4 WHERE id = ?5`)
    .bind(newStatus, now, admin.actor, note, id)
    .run();

  const result = { ok: true, id, ticket: msg.ticket, status: newStatus, discussion_url: msg.discussion_url || null };

  // Optional mirror to GitHub Discussions (only once per message).
  if (action === 'approve' && body.publish_discussion !== false && discussionsConfigured(env) && !msg.discussion_url) {
    try {
      const discussion = await createDiscussion(env, {
        title: msg.subject,
        body: renderDiscussion(msg),
      });
      await db.prepare(`UPDATE messages SET discussion_url = ?1 WHERE id = ?2`).bind(discussion.url, id).run();
      result.discussion_url = discussion.url;
    } catch (err) {
      console.error('Discussion publishing failed for', msg.ticket, err.message);
      result.discussion_error = 'Publishing to GitHub Discussions failed; the message is approved on the board.';
    }
  }
  return json(result);
}

/** Discussion body: author label + quoted text. Never includes name-as-email or email. */
function renderDiscussion(msg) {
  return [
    `Posted by **${escapeInline(msg.author_display)}** via the STAC website${
      msg.instrument_id ? ` (instrument \`${msg.instrument_id}\`)` : ''
    }.`,
    '',
    blockquote(msg.body),
    '',
    `_Moderated message ${msg.ticket}. The author does not have a GitHub account linked to this post._`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Access requests
// ---------------------------------------------------------------------------

export async function handleAdminListAccessRequests({ env, url }) {
  const db = requireEnv(env, 'DB');
  const status = v.oneOf(url.searchParams.get('status'), ['pending', 'approved', 'denied'], {
    required: false,
    field: 'status',
  });
  const { results } = await db
    .prepare(
      `SELECT id, ticket, created_at, instrument_id, file_path, name, email, institution, purpose, intended_use,
              status, forward_status, github_issue_url, approved_file_path, token_expires_at, decided_at, decided_by, decision_note
       FROM access_requests WHERE (?1 IS NULL OR status = ?1)
       ORDER BY created_at DESC, id DESC LIMIT 500`,
    )
    .bind(status)
    .all();
  return json(results);
}

export async function handleAdminApproveAccess({ request, env, params, admin }) {
  const db = requireEnv(env, 'DB');
  const id = v.positiveInt(params[0], { field: 'id' });
  const body = await readJsonBody(request, { maxBytes: MAX_BODY.admin, optional: true });
  const note = v.text(body.note, { field: 'note', max: LIMITS.note.max });

  const row = await db.prepare(`SELECT * FROM access_requests WHERE id = ?1`).bind(id).first();
  if (!row) throw new HttpError(404, 'not_found', 'Access request not found');

  // The admin may pick the file when the requester did not name one.
  const filePath = v.filePath(body.file_path) || row.file_path;
  if (!filePath) {
    throw new HttpError(400, 'validation_failed', 'file_path: required because the request does not name a file');
  }
  const key = `${row.instrument_id}/${filePath}`;

  const ttlDays = intEnv(env, 'DOWNLOAD_TTL_DAYS', DEFAULT_DOWNLOAD_TTL_DAYS);
  const expiresAtSec = Math.floor(Date.now() / 1000) + ttlDays * 86400;
  const expiresAtIso = new Date(expiresAtSec * 1000).toISOString();
  const token = await signDownloadToken(env, { requestId: id, key, expiresAt: expiresAtSec });

  await db
    .prepare(
      `UPDATE access_requests
       SET status = 'approved', approved_file_path = ?1, token_expires_at = ?2, decided_at = ?3, decided_by = ?4, decision_note = ?5
       WHERE id = ?6`,
    )
    .bind(filePath, expiresAtIso, new Date().toISOString(), admin.actor, note, id)
    .run();

  // Warn (do not fail) when the object is not in R2 yet.
  let objectExists = null;
  if (env.RESTRICTED && typeof env.RESTRICTED.head === 'function') {
    objectExists = (await env.RESTRICTED.head(key)) !== null;
  }

  return json({
    ok: true,
    id,
    ticket: row.ticket,
    file_key: key,
    download_url: `${apiBase(request, env)}/v1/download/${token}`,
    expires_at: expiresAtIso,
    object_exists: objectExists,
  });
}

export async function handleAdminDenyAccess({ request, env, params, admin }) {
  const db = requireEnv(env, 'DB');
  const id = v.positiveInt(params[0], { field: 'id' });
  const body = await readJsonBody(request, { maxBytes: MAX_BODY.admin, optional: true });
  const note = v.text(body.note, { field: 'note', max: LIMITS.note.max });

  const result = await db
    .prepare(
      `UPDATE access_requests SET status = 'denied', decided_at = ?1, decided_by = ?2, decision_note = ?3 WHERE id = ?4`,
    )
    .bind(new Date().toISOString(), admin.actor, note, id)
    .run();
  if (!result.meta?.changes) throw new HttpError(404, 'not_found', 'Access request not found');
  return json({ ok: true, id, status: 'denied' });
}
