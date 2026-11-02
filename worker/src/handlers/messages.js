/**
 * POST /v1/messages   (Turnstile-protected)
 * GET  /v1/board      (approved public messages)
 *
 * Routing of a message by kind:
 *   private | error | missing  -> always private: issue in the private inbox repo
 *   public                     -> always public: moderation queue (status 'pending')
 *   general                    -> follows `visibility` (default 'private')
 *
 * Email is optional and is never returned by a public endpoint or posted to
 * a public place. For private messages it is included in the issue in the
 * PRIVATE inbox repo so moderators can reply.
 */

import { json, readJsonBody } from '../lib/http.js';
import { ALWAYS_PRIVATE_KINDS, ISSUE_LABELS, LIMITS, MAX_BODY, MESSAGE_KINDS, RATE_LIMITS, SOURCE_LABEL } from '../lib/constants.js';
import * as v from '../lib/validate.js';
import { verifyTurnstile } from '../lib/turnstile.js';
import { enforceRateLimit } from '../lib/db.js';
import { displayName } from '../lib/pseudonym.js';
import { createInboxIssue, escapeInline, fenced, inboxConfigured, neutralizeMentions } from '../lib/github.js';
import { insertWithTicket, requireEnv, visitorContext } from './common.js';

function resolveVisibility(kind, visibility) {
  if (ALWAYS_PRIVATE_KINDS.includes(kind)) return 'private';
  if (kind === 'public') return 'public';
  return visibility || 'private';
}

export async function handleCreateMessage({ request, env }) {
  const db = requireEnv(env, 'DB');
  const body = await readJsonBody(request, { maxBytes: MAX_BODY.form });

  // 1. Validate everything before spending a rate-limit hit or a siteverify call.
  const kind = v.oneOf(body.kind, MESSAGE_KINDS, { field: 'kind' });
  const instrumentId = v.instrumentId(body.instrument_id, { required: false });
  const subject = v.text(body.subject, { field: 'subject', ...LIMITS.subject, required: true, singleLine: true });
  const text = v.text(body.body, { field: 'body', ...LIMITS.body, required: true });
  const name = v.personName(body.name);
  const email = v.email(body.email);
  const visibility = v.oneOf(body.visibility, ['private', 'public'], { required: false, field: 'visibility' });
  const optinId = v.optinId(body.optin_id);
  const effectiveVisibility = resolveVisibility(kind, visibility);

  // 2. Abuse protection.
  const visitor = await visitorContext(request, env, optinId);
  await enforceRateLimit(db, `form:${visitor.visitorHash}`, RATE_LIMITS.forms);
  await verifyTurnstile(env, body.turnstile_token, visitor.ip);

  // 3. Store. The public author label is the given name or a pseudonym.
  const authorDisplay = name || displayName(visitor.pseudonym || visitor.visitorHash);
  const status = effectiveVisibility === 'public' ? 'pending' : 'stored';
  const { id, ticket } = await insertWithTicket((t) =>
    db
      .prepare(
        `INSERT INTO messages (ticket, created_at, kind, visibility, status, instrument_id, subject, body, name, email, author_display)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) RETURNING id`,
      )
      .bind(t, visitor.ts, kind, effectiveVisibility, status, instrumentId, subject, text, name, email, authorDisplay),
  );

  // 4. Private messages: forward to the private inbox repo. A GitHub failure
  //    does not fail the request; the row stays in D1 as 'forward_failed'
  //    and is visible via GET /v1/admin/messages?status=forward_failed.
  if (effectiveVisibility === 'private' && inboxConfigured(env)) {
    try {
      const issue = await createInboxIssue(env, {
        title: neutralizeMentions(`${ticket} [${kind}] ${subject}`),
        body: renderMessageIssue({ ticket, kind, instrumentId, subject, text, name, email, createdAt: visitor.ts }),
        labels: [ISSUE_LABELS[kind], SOURCE_LABEL],
      });
      await db
        .prepare(`UPDATE messages SET status = 'forwarded', github_issue_number = ?1, github_issue_url = ?2 WHERE id = ?3`)
        .bind(issue.number, issue.url, id)
        .run();
    } catch (err) {
      console.error('Inbox forwarding failed for', ticket, err.message);
      await db.prepare(`UPDATE messages SET status = 'forward_failed' WHERE id = ?1`).bind(id).run();
    }
  }

  return json({ ok: true, ticket }, 201);
}

function renderMessageIssue({ ticket, kind, instrumentId, subject, text, name, email, createdAt }) {
  return [
    `| Field | Value |`,
    `| --- | --- |`,
    `| Ticket | ${ticket} |`,
    `| Kind | ${kind} |`,
    `| Instrument | ${instrumentId ? escapeInline(instrumentId) : '(none)'} |`,
    `| Subject | ${escapeInline(subject)} |`,
    `| Name | ${name ? escapeInline(name) : '(not given)'} |`,
    `| Email | ${email ? escapeInline(email) : '(not given)'} |`,
    `| Received | ${createdAt} |`,
    '',
    'Message (shown verbatim):',
    '',
    fenced(text),
    '',
    '_Created by the STAC API. This repository is private: do not copy email addresses into public channels._',
  ].join('\n');
}

/** GET /v1/board?instrument_id=&limit= */
export async function handleBoard({ env, url }) {
  const db = requireEnv(env, 'DB');
  const instrumentId = v.instrumentId(url.searchParams.get('instrument_id'), { required: false });
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.min(v.positiveInt(limitParam, { field: 'limit' }), 500) : 200;

  const { results } = await db
    .prepare(
      `SELECT id, created_at, instrument_id, subject, body, author_display, discussion_url
       FROM messages
       WHERE visibility = 'public' AND status = 'approved' AND (?1 IS NULL OR instrument_id = ?1)
       ORDER BY created_at DESC, id DESC
       LIMIT ?2`,
    )
    .bind(instrumentId, limit)
    .all();

  // Explicit field list: email and name are never part of the public shape.
  const board = results.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    instrument_id: r.instrument_id,
    subject: r.subject,
    body: r.body,
    author_display: r.author_display,
    discussion_url: r.discussion_url || null,
  }));
  return json(board, 200, { 'Cache-Control': 'public, max-age=60' });
}
