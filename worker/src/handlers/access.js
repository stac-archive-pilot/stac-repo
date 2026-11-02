/**
 * POST /v1/access-requests   (Turnstile-protected)
 * GET  /v1/download/:token   (signed, time-limited link for restricted files)
 */

import { HttpError, json, readJsonBody } from '../lib/http.js';
import { INTENDED_USES, ISSUE_LABELS, LIMITS, MAX_BODY, RATE_LIMITS, SOURCE_LABEL } from '../lib/constants.js';
import * as v from '../lib/validate.js';
import { verifyTurnstile } from '../lib/turnstile.js';
import { enforceRateLimit, insertEvent } from '../lib/db.js';
import { createInboxIssue, escapeInline, fenced, inboxConfigured, neutralizeMentions } from '../lib/github.js';
import { verifyDownloadToken } from '../lib/tokens.js';
import { insertWithTicket, requireEnv, visitorContext } from './common.js';

export async function handleCreateAccessRequest({ request, env }) {
  const db = requireEnv(env, 'DB');
  const body = await readJsonBody(request, { maxBytes: MAX_BODY.form });

  const instrumentId = v.instrumentId(body.instrument_id);
  const filePath = v.filePath(body.file_path);
  const name = v.personName(body.name, { required: true });
  const email = v.email(body.email, { required: true });
  const institution = v.text(body.institution, { field: 'institution', ...LIMITS.institution, required: true, singleLine: true });
  const purpose = v.text(body.purpose, { field: 'purpose', ...LIMITS.purpose, required: true });
  const intendedUse = v.oneOf(body.intended_use, INTENDED_USES, { field: 'intended_use' });

  const visitor = await visitorContext(request, env);
  await enforceRateLimit(db, `form:${visitor.visitorHash}`, RATE_LIMITS.forms);
  await verifyTurnstile(env, body.turnstile_token, visitor.ip);

  const { id, ticket } = await insertWithTicket((t) =>
    db
      .prepare(
        `INSERT INTO access_requests (ticket, created_at, instrument_id, file_path, name, email, institution, purpose, intended_use, status, forward_status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', 'stored') RETURNING id`,
      )
      .bind(t, visitor.ts, instrumentId, filePath, name, email, institution, purpose, intendedUse),
  );

  if (inboxConfigured(env)) {
    try {
      const issue = await createInboxIssue(env, {
        title: neutralizeMentions(`${ticket} [access-request] ${instrumentId}${filePath ? `/${filePath}` : ''}`),
        body: renderAccessIssue({ id, ticket, instrumentId, filePath, name, email, institution, purpose, intendedUse, createdAt: visitor.ts }),
        labels: [ISSUE_LABELS.access, SOURCE_LABEL],
      });
      await db
        .prepare(
          `UPDATE access_requests SET forward_status = 'forwarded', github_issue_number = ?1, github_issue_url = ?2 WHERE id = ?3`,
        )
        .bind(issue.number, issue.url, id)
        .run();
    } catch (err) {
      console.error('Inbox forwarding failed for', ticket, err.message);
      await db.prepare(`UPDATE access_requests SET forward_status = 'forward_failed' WHERE id = ?1`).bind(id).run();
    }
  }

  return json({ ok: true, ticket }, 201);
}

function renderAccessIssue({ id, ticket, instrumentId, filePath, name, email, institution, purpose, intendedUse, createdAt }) {
  return [
    `| Field | Value |`,
    `| --- | --- |`,
    `| Ticket | ${ticket} |`,
    `| Request id | ${id} |`,
    `| Instrument | ${escapeInline(instrumentId)} |`,
    `| File | ${filePath ? escapeInline(filePath) : '(not specified: choose one when approving)'} |`,
    `| Name | ${escapeInline(name)} |`,
    `| Email | ${escapeInline(email)} |`,
    `| Institution | ${escapeInline(institution)} |`,
    `| Intended use | ${intendedUse} |`,
    `| Received | ${createdAt} |`,
    '',
    'Purpose (shown verbatim):',
    '',
    fenced(purpose),
    '',
    `Approve: \`POST /v1/admin/access-requests/${id}/approve\` (returns a time-limited download link to send to the requester).`,
    `Deny: \`POST /v1/admin/access-requests/${id}/deny\`.`,
  ].join('\n');
}

/** Content-Disposition with an RFC 6266 / RFC 5987 encoded file name. */
function contentDisposition(filePath) {
  const base = filePath.split('/').pop();
  const ascii = base.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(base)}`;
}

export async function handleDownload({ request, env, params }) {
  const db = requireEnv(env, 'DB');
  const payload = await verifyDownloadToken(env, params[0]);

  // The token is only a capability; the request must still be approved and
  // the key must be exactly the approved file. Denying revokes the link.
  const row = await db
    .prepare(`SELECT id, instrument_id, approved_file_path, status FROM access_requests WHERE id = ?1`)
    .bind(payload.r)
    .first();
  if (!row || row.status !== 'approved' || !row.approved_file_path) {
    throw new HttpError(403, 'access_revoked', 'This download link is no longer valid');
  }
  const key = `${row.instrument_id}/${row.approved_file_path}`;
  if (payload.k !== key) throw new HttpError(403, 'invalid_token', 'Download link is invalid');

  await enforceRateLimit(db, `dl:${row.id}`, RATE_LIMITS.downloads);

  const bucket = requireEnv(env, 'RESTRICTED');
  const object = await bucket.get(key);
  if (!object) throw new HttpError(404, 'not_found', 'The requested file is not available');

  const visitor = await visitorContext(request, env);
  await insertEvent(db, {
    ts: visitor.ts,
    day: visitor.day,
    type: 'download',
    instrumentId: row.instrument_id,
    filePath: row.approved_file_path,
    visitorHash: visitor.visitorHash,
    pseudonym: null,
  });

  const headers = new Headers();
  if (typeof object.writeHttpMetadata === 'function') object.writeHttpMetadata(headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/octet-stream');
  headers.set('Content-Disposition', contentDisposition(row.approved_file_path));
  headers.set('Cache-Control', 'private, no-store');
  // No manual Content-Length: the runtime derives it from the R2 body stream.
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  return new Response(object.body, { status: 200, headers });
}
