#!/usr/bin/env node
/**
 * Dependency-free test suite for the STAC API worker (Node 22+).
 *
 *   node test/run-tests.mjs
 *
 * The worker module is imported directly and called with a mock env:
 * in-memory D1 (node:sqlite), fake R2, stubbed fetch for Turnstile, GitHub
 * and the Cloudflare Access JWKS. Nothing touches the network.
 */

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeD1, createFakeR2, createFetchStub } from './fakes.mjs';

// node:sqlite prints an ExperimentalWarning on Node 22; silence just that.
const originalEmitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  if (String(warning).includes('SQLite')) return;
  return originalEmitWarning.call(process, warning, ...rest);
};
const { DatabaseSync } = await import('node:sqlite');

const here = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(join(here, '..', 'schema.sql'), 'utf8');
const { default: worker } = await import('../src/index.js');
const { signDownloadToken } = await import('../src/lib/tokens.js');
const { visitorHash, displayName } = await import('../src/lib/pseudonym.js');
const { addDays, utcDay } = await import('../src/lib/time.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SECRET = 'test-pseudonym-secret';
const TEST_IP = '203.0.113.77';
const TEST_UA = 'Mozilla/5.0 (StacTest; secret-ua-marker)';
const ORIGIN = 'https://stac-archive.github.io';
const ADMIN_TOKEN = 'admin-token-0123456789abcdef0123456789abcdef';
const ACCESS_TEAM = 'stac-test.cloudflareaccess.com';
const ACCESS_AUD = 'aud-stac-admin-123';

function makeEnv(overrides = {}) {
  return {
    DB: createFakeD1(DatabaseSync, schemaSql),
    RESTRICTED: createFakeR2(),
    PSEUDONYM_SECRET: SECRET,
    TURNSTILE_SECRET: 'test-turnstile-secret',
    GITHUB_TOKEN: 'github_pat_test',
    INBOX_REPO: 'stac-archive/stac-inbox',
    ADMIN_TOKEN,
    ALLOWED_ORIGINS: `${ORIGIN}, http://localhost:8000`,
    RAW_RETENTION_DAYS: '90',
    STATS_CACHE_SECONDS: '0',
    DISCUSSIONS_REPO_ID: 'R_testrepo',
    DISCUSSIONS_CATEGORY_ID: 'DIC_testcat',
    ACCESS_TEAM_DOMAIN: ACCESS_TEAM,
    ACCESS_AUD,
    PUBLIC_API_BASE: 'https://api.stac.test',
    ...overrides,
  };
}

/** Call the worker like the Workers runtime would. */
async function call(env, method, path, { body, headers = {}, contentType = 'application/json', ip = TEST_IP, ua = TEST_UA } = {}) {
  const h = new Headers({ 'CF-Connecting-IP': ip, 'User-Agent': ua, ...headers });
  let payload;
  if (body !== undefined) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    if (!h.has('Content-Type') && contentType) h.set('Content-Type', contentType);
  }
  const request = new Request(`https://api.stac.test${path}`, { method, headers: h, body: payload });
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p), passThroughOnException() {} };
  const response = await worker.fetch(request, env, ctx);
  await Promise.all(waits);
  const text = await response.text();
  let data = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: response.status, headers: response.headers, data, text };
}

const adminHeaders = { Authorization: `Bearer ${ADMIN_TOKEN}` };
const event = (type, instrument_id, extra = {}) => ({ type, instrument_id, ...extra });

// ---------------------------------------------------------------------------
// Fake upstreams: Turnstile, GitHub REST + GraphQL, Cloudflare Access JWKS
// ---------------------------------------------------------------------------

const upstream = { githubFails: false, jwks: { keys: [] }, issueCounter: 100 };

const fetchStub = createFetchStub([
  [
    /^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/siteverify$/,
    async (_url, init) => {
      const form = init.body; // FormData
      const ok = form.get('secret') === 'test-turnstile-secret' && form.get('response') !== 'bad-token';
      return Response.json(ok ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] });
    },
  ],
  [
    /^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+\/issues$/,
    async (url) => {
      if (upstream.githubFails) return new Response('boom', { status: 502 });
      const number = ++upstream.issueCounter;
      return Response.json(
        { number, html_url: url.replace('api.github.com/repos', 'github.com').replace(/issues$/, `issues/${number}`) },
        { status: 201 },
      );
    },
  ],
  [
    /^https:\/\/api\.github\.com\/graphql$/,
    async () =>
      Response.json({
        data: { createDiscussion: { discussion: { number: 7, url: 'https://github.com/stac-archive/stac/discussions/7' } } },
      }),
  ],
  [/^https:\/\/stac-test\.cloudflareaccess\.com\/cdn-cgi\/access\/certs$/, async () => Response.json(upstream.jwks)],
]);

const callsTo = (pattern) => fetchStub.calls.filter((c) => pattern.test(c.url));
const resetCalls = () => fetchStub.calls.splice(0);

// RSA key pair acting as the Cloudflare Access signing key.
const accessKeys = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const publicJwk = await crypto.subtle.exportKey('jwk', accessKeys.publicKey);
upstream.jwks = { keys: [{ ...publicJwk, kid: 'test-kid-1', alg: 'RS256', use: 'sig' }] };

const b64url = (data) => Buffer.from(data).toString('base64url');
async function makeAccessJwt(claimsOverride = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', kid: 'test-kid-1', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      aud: [ACCESS_AUD],
      iss: `https://${ACCESS_TEAM}`,
      email: 'moderator@example.org',
      sub: 'user-1',
      iat: now,
      nbf: now,
      exp: now + 600,
      ...claimsOverride,
    }),
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', accessKeys.privateKey, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(new Uint8Array(sig))}`;
}

// ---------------------------------------------------------------------------
// Minimal test runner
// ---------------------------------------------------------------------------

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('health endpoint reports ok and sets security headers', async () => {
  const env = makeEnv();
  const res = await call(env, 'GET', '/v1/health');
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);
  assert.equal(res.data.checks.db, 'ok');
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(res.headers.get('Referrer-Policy'), 'no-referrer');
  assert.match(res.headers.get('Content-Security-Policy'), /default-src 'none'/);
});

test('unknown route -> 404 and wrong method -> 405, both with the standard error shape', async () => {
  const env = makeEnv();
  const r404 = await call(env, 'GET', '/v1/nope');
  assert.equal(r404.status, 404);
  assert.deepEqual(Object.keys(r404.data.error).sort(), ['code', 'message']);
  assert.equal(r404.data.error.code, 'not_found');
  const r405 = await call(env, 'GET', '/v1/events');
  assert.equal(r405.status, 405);
  assert.equal(r405.data.error.code, 'method_not_allowed');
  assert.match(r405.headers.get('Allow'), /POST/);
});

test('event ingestion: 204, stores derived hash, never stores IP or user agent', async () => {
  const env = makeEnv();
  // text/plain like navigator.sendBeacon
  const res = await call(env, 'POST', '/v1/events', {
    body: event('view', 'alternate-uses-task', { file_path: 'materials/AUT form A.pdf' }),
    contentType: 'text/plain;charset=UTF-8',
    headers: { Origin: ORIGIN },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);

  const rows = env.DB.query('SELECT * FROM events');
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.type, 'view');
  assert.equal(row.instrument_id, 'alternate-uses-task');
  assert.equal(row.file_path, 'materials/AUT form A.pdf');
  assert.equal(row.pseudonym, null);
  assert.match(row.visitor_hash, /^[0-9a-f]{16}$/);

  // Independent recomputation with node:crypto.
  const day = utcDay();
  const expected = createHmac('sha256', SECRET).update(`${day}|${TEST_IP}|${TEST_UA}`).digest('hex').slice(0, 16);
  assert.equal(row.visitor_hash, expected);

  // No column for IP/UA, and the raw values appear nowhere in the database.
  const columns = env.DB.query('PRAGMA table_info(events)').map((c) => c.name);
  for (const forbidden of ['ip', 'ip_address', 'user_agent', 'ua']) assert.ok(!columns.includes(forbidden));
  const everything = JSON.stringify(env.DB.dumpAll());
  assert.ok(!everything.includes(TEST_IP), 'IP leaked into D1');
  assert.ok(!everything.includes('secret-ua-marker'), 'User agent leaked into D1');
});

test('visitor hash rotates with the daily salt', async () => {
  const a = await visitorHash(SECRET, '2026-10-21', TEST_IP, TEST_UA);
  const b = await visitorHash(SECRET, '2026-10-22', TEST_IP, TEST_UA);
  const c = await visitorHash(SECRET, '2026-10-22', TEST_IP, TEST_UA);
  assert.notEqual(a, b);
  assert.equal(b, c);
});

test('opt-in pseudonym is deterministic across IPs and days, and distinct per opt-in id', async () => {
  const env = makeEnv();
  const optin = '8f14e45f-ceea-4672-9b6d-3c1a2f0e9d11';
  const other = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
  await call(env, 'POST', '/v1/events', { body: event('view', 'dat-task', { optin_id: optin }), ip: '198.51.100.1' });
  await call(env, 'POST', '/v1/events', { body: event('download', 'dat-task', { optin_id: optin.toUpperCase() }), ip: '198.51.100.2', ua: 'Other/1.0' });
  await call(env, 'POST', '/v1/events', { body: event('view', 'dat-task', { optin_id: other }) });
  await call(env, 'POST', '/v1/events', { body: event('view', 'dat-task') });

  const rows = env.DB.query('SELECT visitor_hash, pseudonym FROM events ORDER BY id');
  const expected = createHmac('sha256', SECRET).update(`optin:${optin}`).digest('hex').slice(0, 16);
  assert.equal(rows[0].pseudonym, expected);
  assert.equal(rows[1].pseudonym, expected);
  assert.notEqual(rows[0].visitor_hash, rows[1].visitor_hash); // different IP/UA -> different daily hash
  assert.notEqual(rows[2].pseudonym, expected);
  assert.equal(rows[3].pseudonym, null);

  const name = displayName(expected);
  assert.match(name, /^[a-z]+-[a-z]+-[0-9a-f]{4}$/);
  assert.equal(name, displayName(expected));

  const log = await call(env, 'GET', '/v1/admin/log', { headers: adminHeaders });
  assert.equal(log.status, 200);
  const visitors = log.data.map((r) => r.visitor);
  assert.equal(visitors.filter((v) => v === name).length, 2);
  assert.ok(visitors.some((v) => /^anon-[0-9a-f]{6}$/.test(v)));
  for (const row of log.data) assert.deepEqual(Object.keys(row).sort(), ['file_path', 'instrument_id', 'ts', 'type', 'visitor']);
});

test('invalid event input is rejected', async () => {
  const env = makeEnv();
  const cases = [
    [{ type: 'click', instrument_id: 'dat-task' }, 400],
    [{ type: 'view', instrument_id: 'DAT-Task' }, 400],
    [{ type: 'view', instrument_id: 'x' }, 400],
    [{ type: 'view', instrument_id: '../etc' }, 400],
    [{ type: 'view' }, 400],
    [{ type: 'view', instrument_id: 'dat-task', file_path: '../secret.pdf' }, 400],
    [{ type: 'view', instrument_id: 'dat-task', file_path: '/abs.pdf' }, 400],
    [{ type: 'view', instrument_id: 'dat-task', optin_id: 'not-a-uuid' }, 400],
  ];
  for (const [body, status] of cases) {
    const res = await call(env, 'POST', '/v1/events', { body });
    assert.equal(res.status, status, JSON.stringify(body));
    assert.equal(res.data.error.code, 'validation_failed');
  }
  const badJson = await call(env, 'POST', '/v1/events', { body: '{not json' });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.data.error.code, 'invalid_json');
  const badType = await call(env, 'POST', '/v1/events', { body: '{}', contentType: 'application/xml' });
  assert.equal(badType.status, 415);
  const tooBig = await call(env, 'POST', '/v1/events', { body: JSON.stringify({ type: 'view', instrument_id: 'dat-task', pad: 'x'.repeat(5000) }) });
  assert.equal(tooBig.status, 413);
  assert.equal(env.DB.query('SELECT COUNT(*) AS n FROM events')[0].n, 0);
});

test('event rate limit: 120 per 10 minutes per visitor, then 429', async () => {
  const env = makeEnv();
  for (let i = 0; i < 120; i++) {
    const res = await call(env, 'POST', '/v1/events', { body: event('view', 'dat-task') });
    assert.equal(res.status, 204);
  }
  const limited = await call(env, 'POST', '/v1/events', { body: event('view', 'dat-task') });
  assert.equal(limited.status, 429);
  assert.equal(limited.data.error.code, 'rate_limited');
  assert.ok(Number(limited.headers.get('Retry-After')) > 0);
  assert.equal(env.DB.query('SELECT COUNT(*) AS n FROM events')[0].n, 120);
  // A different visitor is unaffected.
  const other = await call(env, 'POST', '/v1/events', { body: event('view', 'dat-task'), ip: '198.51.100.9' });
  assert.equal(other.status, 204);
});

test('stats summary aggregates totals, per instrument and a 365-day zero-filled timeseries', async () => {
  const env = makeEnv();
  const send = (type, id, extra) => call(env, 'POST', '/v1/events', { body: event(type, id, extra) });
  await send('view', 'aut');
  await send('view', 'aut');
  await send('download', 'aut', { file_path: 'aut.pdf' });
  await send('preview', 'aut', { file_path: 'aut.pdf' });
  await send('interest', 'aut');
  await send('view', 'dat-task');
  await send('fork_click', 'dat-task');
  await send('cite_copy', 'dat-task');

  const res = await call(env, 'GET', '/v1/stats/summary', { headers: { Origin: ORIGIN } });
  assert.equal(res.status, 200);
  const s = res.data;
  assert.ok(!Number.isNaN(Date.parse(s.updated_at)));
  assert.deepEqual(s.totals, { views: 3, downloads: 1, previews: 1, interest: 1, fork_clicks: 1, cite_copies: 1 });
  assert.deepEqual(s.by_instrument.aut, { views: 2, downloads: 1, previews: 1, interest: 1 });
  assert.deepEqual(s.by_instrument['dat-task'], { views: 1, downloads: 0, previews: 0, interest: 0 });
  assert.equal(s.timeseries.length, 365);
  const last = s.timeseries.at(-1);
  assert.deepEqual(last, { date: utcDay(), views: 3, downloads: 1, previews: 1 });
  assert.deepEqual(s.timeseries[0], { date: addDays(utcDay(), -364), views: 0, downloads: 0, previews: 0 });
});

test('stats for one instrument include by_file', async () => {
  const env = makeEnv();
  const send = (type, id, extra) => call(env, 'POST', '/v1/events', { body: event(type, id, extra) });
  await send('download', 'aut', { file_path: 'aut.pdf' });
  await send('download', 'aut', { file_path: 'aut.pdf' });
  await send('preview', 'aut', { file_path: 'scoring/manual.docx' });
  await send('view', 'aut');
  await send('download', 'other-task', { file_path: 'x.pdf' });

  const res = await call(env, 'GET', '/v1/stats/instrument/aut');
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.totals, { views: 1, downloads: 2, previews: 1, interest: 0, fork_clicks: 0, cite_copies: 0 });
  assert.deepEqual(Object.keys(res.data.by_instrument), ['aut']);
  assert.deepEqual(res.data.by_file, {
    'aut.pdf': { downloads: 2, previews: 0 },
    'scoring/manual.docx': { downloads: 0, previews: 1 },
  });
  const bad = await call(env, 'GET', '/v1/stats/instrument/NOT_VALID');
  assert.equal(bad.status, 400);
});

test('cron: aggregates without double counting, purges old raw events and rate-limit rows', async () => {
  const env = makeEnv();
  const today = utcDay();
  const insert = env.DB.prepare(
    `INSERT INTO events (ts, day, type, instrument_id, file_path, visitor_hash, pseudonym) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)`,
  );
  const seed = [
    [addDays(today, -400), 'view', 'aut', null, 'aaaaaaaaaaaaaaaa'],
    [addDays(today, -100), 'view', 'aut', null, 'aaaaaaaaaaaaaaaa'],
    [addDays(today, -100), 'view', 'aut', null, 'bbbbbbbbbbbbbbbb'],
    [addDays(today, -100), 'download', 'aut', 'aut.pdf', 'aaaaaaaaaaaaaaaa'],
    [addDays(today, -5), 'preview', 'dat-task', 'dat.pdf', 'cccccccccccccccc'],
    [addDays(today, -1), 'view', 'dat-task', null, 'dddddddddddddddd'],
  ];
  for (const [day, type, id, file, vh] of seed) await insert.bind(`${day}T12:00:00.000Z`, day, type, id, file, vh).run();
  await call(env, 'POST', '/v1/events', { body: event('view', 'aut') }); // today, stays raw

  const before = (await call(env, 'GET', '/v1/stats/summary')).data;
  assert.equal(before.totals.views, 5);

  const summary = await worker.scheduled({ scheduledTime: Date.now(), cron: '17 3 * * *' }, env, { waitUntil() {} });
  assert.equal(summary.aggregated_through, addDays(today, -1));
  assert.equal(summary.purged_events, 4); // the -400 and -100 days
  await worker.scheduled({ scheduledTime: Date.now(), cron: '17 3 * * *' }, env, { waitUntil() {} }); // idempotent

  const after = (await call(env, 'GET', '/v1/stats/summary')).data;
  assert.deepEqual(after.totals, before.totals);
  assert.deepEqual(after.by_instrument, before.by_instrument);
  assert.deepEqual(after.timeseries, before.timeseries);

  const raw = env.DB.query('SELECT day FROM events ORDER BY day');
  assert.deepEqual(raw.map((r) => r.day), [addDays(today, -5), addDays(today, -1), today]);
  const agg = env.DB.query(`SELECT * FROM daily_aggregates WHERE day = ?1 AND type = 'view'`, addDays(today, -100));
  assert.equal(agg[0].events, 2);
  assert.equal(agg[0].visitors, 2);
  // The rate-limit row from today's event belongs to a window that has not
  // expired yet; a run "tomorrow" removes it.
  assert.ok(env.DB.query('SELECT COUNT(*) AS n FROM rate_limits')[0].n >= 1);
  await worker.scheduled({ scheduledTime: Date.now() + 86400000 }, env, { waitUntil() {} });
  assert.equal(env.DB.query('SELECT COUNT(*) AS n FROM rate_limits')[0].n, 0);
});

test('private message -> Turnstile verified, GitHub issue in inbox repo with kind label, row stored', async () => {
  const env = makeEnv();
  resetCalls();
  const res = await call(env, 'POST', '/v1/messages', {
    headers: { Origin: ORIGIN },
    body: {
      kind: 'private',
      instrument_id: 'aut',
      subject: 'Question about scoring @stac-team',
      body: 'Hello @octocat, how is the ``` scoring done?',
      name: 'Ada',
      email: 'ada@example.org',
      turnstile_token: 'good-token',
    },
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.ok, true);
  assert.match(res.data.ticket, /^STAC-[A-HJ-NP-Z2-9]{6}$/);

  const ts = callsTo(/turnstile/);
  assert.equal(ts.length, 1);
  assert.equal(ts[0].init.body.get('remoteip'), TEST_IP);

  const gh = callsTo(/api\.github\.com\/repos/);
  assert.equal(gh.length, 1);
  assert.equal(gh[0].url, 'https://api.github.com/repos/stac-archive/stac-inbox/issues');
  assert.equal(gh[0].init.method, 'POST');
  assert.equal(gh[0].init.headers.Authorization, 'Bearer github_pat_test');
  const issue = JSON.parse(gh[0].init.body);
  assert.deepEqual(issue.labels, ['private-message', 'via-stac-api']);
  assert.ok(issue.title.startsWith(res.data.ticket));
  assert.ok(issue.body.includes('````text'), 'body must be fenced with a fence longer than any backtick run');
  // Inside a fenced block GitHub renders nothing (no mentions); inline fields and the title are neutralized.
  assert.ok(issue.body.includes('Hello @octocat, how is the ``` scoring done?\n````'));
  assert.ok(issue.body.includes('@\u200Bstac-team') && issue.title.includes('@\u200Bstac-team'), 'mentions must be neutralized');
  assert.ok(!issue.body.includes('scoring @stac-team'));

  const [row] = env.DB.query('SELECT * FROM messages');
  assert.equal(row.status, 'forwarded');
  assert.equal(row.visibility, 'private');
  assert.equal(row.ticket, res.data.ticket);
  assert.match(row.github_issue_url, /^https:\/\/github\.com\/stac-archive\/stac-inbox\/issues\/\d+$/);
});

test('error/missing kinds get their own labels; GitHub outage keeps the message as forward_failed', async () => {
  const env = makeEnv();
  resetCalls();
  const base = { subject: 'Broken link on page', body: 'The PDF link 404s.', turnstile_token: 't' };
  await call(env, 'POST', '/v1/messages', { body: { ...base, kind: 'error' } });
  await call(env, 'POST', '/v1/messages', { body: { ...base, kind: 'missing', visibility: 'public' } }); // stays private
  const labels = callsTo(/api\.github\.com\/repos/).map((c) => JSON.parse(c.init.body).labels[0]);
  assert.deepEqual(labels, ['error-report', 'missing-material']);

  upstream.githubFails = true;
  try {
    const res = await call(env, 'POST', '/v1/messages', { body: { ...base, kind: 'general' } });
    assert.equal(res.status, 201);
    const row = env.DB.query('SELECT status FROM messages WHERE ticket = ?1', res.data.ticket)[0];
    assert.equal(row.status, 'forward_failed');
  } finally {
    upstream.githubFails = false;
  }
  const failed = await call(env, 'GET', '/v1/admin/messages?status=forward_failed', { headers: adminHeaders });
  assert.equal(failed.data.length, 1);
});

test('message validation and Turnstile failure', async () => {
  const env = makeEnv();
  resetCalls();
  const ok = { kind: 'private', subject: 'Hello there', body: 'Some body text', turnstile_token: 't' };
  const bad = [
    { ...ok, kind: 'spam' },
    { ...ok, subject: 'x' },
    { ...ok, body: 'x'.repeat(5001) },
    { ...ok, email: 'not-an-email' },
    { ...ok, name: 'me@example.org' },
    { ...ok, instrument_id: 'Bad Id' },
  ];
  for (const body of bad) {
    const res = await call(env, 'POST', '/v1/messages', { body });
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
  }
  assert.equal(callsTo(/turnstile/).length, 0, 'invalid input must not reach Turnstile');

  const ts = await call(env, 'POST', '/v1/messages', { body: { ...ok, turnstile_token: 'bad-token' } });
  assert.equal(ts.status, 403);
  assert.equal(ts.data.error.code, 'turnstile_failed');
  const missing = await call(env, 'POST', '/v1/messages', { body: { ...ok, turnstile_token: undefined } });
  assert.equal(missing.status, 403);
  assert.equal(callsTo(/api\.github\.com/).length, 0);
  assert.equal(env.DB.query('SELECT COUNT(*) AS n FROM messages')[0].n, 0);
});

test('public message -> pending (not on board) -> approve -> on board + Discussion; email never public', async () => {
  const env = makeEnv();
  resetCalls();
  const res = await call(env, 'POST', '/v1/messages', {
    body: {
      kind: 'public',
      instrument_id: 'aut',
      subject: 'We used AUT in a study',
      body: 'Worked great with 300 participants.',
      name: 'Grace',
      email: 'grace@example.org',
      turnstile_token: 't',
    },
  });
  assert.equal(res.status, 201);
  assert.equal(callsTo(/api\.github\.com/).length, 0, 'public messages are not sent to the inbox');

  let board = await call(env, 'GET', '/v1/board?instrument_id=aut');
  assert.deepEqual(board.data, []);

  const pending = await call(env, 'GET', '/v1/admin/messages?status=pending', { headers: adminHeaders });
  assert.equal(pending.data.length, 1);
  const id = pending.data[0].id;
  assert.equal(pending.data[0].email, 'grace@example.org'); // admins may see it

  const approve = await call(env, 'POST', `/v1/admin/messages/${id}/approve`, { headers: adminHeaders });
  assert.equal(approve.status, 200);
  assert.equal(approve.data.status, 'approved');
  assert.equal(approve.data.discussion_url, 'https://github.com/stac-archive/stac/discussions/7');

  const gql = callsTo(/graphql/);
  assert.equal(gql.length, 1);
  const vars = JSON.parse(gql[0].init.body).variables;
  assert.equal(vars.repositoryId, 'R_testrepo');
  assert.equal(vars.categoryId, 'DIC_testcat');
  assert.ok(vars.body.includes('Grace'));
  assert.ok(!vars.body.includes('grace@example.org'));

  board = await call(env, 'GET', '/v1/board?instrument_id=aut');
  assert.equal(board.data.length, 1);
  const post = board.data[0];
  assert.deepEqual(Object.keys(post).sort(), ['author_display', 'body', 'created_at', 'discussion_url', 'id', 'instrument_id', 'subject']);
  assert.equal(post.author_display, 'Grace');
  assert.ok(!board.text.includes('grace@example.org'));
  assert.deepEqual((await call(env, 'GET', '/v1/board?instrument_id=dat-task')).data, []);

  // Re-approving is a conflict; rejecting unpublishes.
  assert.equal((await call(env, 'POST', `/v1/admin/messages/${id}/approve`, { headers: adminHeaders })).status, 409);
  assert.equal((await call(env, 'POST', `/v1/admin/messages/${id}/reject`, { headers: adminHeaders, body: { note: 'spam' } })).status, 200);
  assert.deepEqual((await call(env, 'GET', '/v1/board')).data, []);
});

test('public message without a name gets a pseudonymous author_display', async () => {
  const env = makeEnv({ DISCUSSIONS_REPO_ID: '' });
  const res = await call(env, 'POST', '/v1/messages', {
    body: { kind: 'general', visibility: 'public', subject: 'Nice archive', body: 'Thanks a lot!', turnstile_token: 't' },
  });
  const [row] = env.DB.query('SELECT id, author_display, status FROM messages WHERE ticket = ?1', res.data.ticket);
  assert.equal(row.status, 'pending');
  assert.match(row.author_display, /^[a-z]+-[a-z]+-[0-9a-f]{4}$/);
  const approve = await call(env, 'POST', `/v1/admin/messages/${row.id}/approve`, { headers: adminHeaders });
  assert.equal(approve.data.discussion_url, null); // Discussions not configured
  assert.equal((await call(env, 'GET', '/v1/board')).data[0].author_display, row.author_display);
});

test('access request -> issue -> approve -> token download works; tampered/expired/revoked tokens fail', async () => {
  const env = makeEnv();
  await env.RESTRICTED.put('restricted-test/manual v2.pdf', 'PDF-CONTENT-123', { httpMetadata: { contentType: 'application/pdf' } });
  resetCalls();

  const req = await call(env, 'POST', '/v1/access-requests', {
    body: {
      instrument_id: 'restricted-test',
      file_path: 'manual v2.pdf',
      name: 'Dr. Lovelace',
      email: 'lovelace@uni.example',
      institution: 'University of Examples',
      purpose: 'Validation study of creativity measures in adolescents.',
      intended_use: 'academic',
      turnstile_token: 't',
    },
  });
  assert.equal(req.status, 201);
  assert.match(req.data.ticket, /^STAC-/);
  const gh = callsTo(/api\.github\.com\/repos/);
  assert.equal(gh.length, 1);
  assert.equal(gh[0].url, 'https://api.github.com/repos/stac-archive/stac-inbox/issues');
  assert.deepEqual(JSON.parse(gh[0].init.body).labels, ['access-request', 'via-stac-api']);

  const list = await call(env, 'GET', '/v1/admin/access-requests', { headers: adminHeaders });
  assert.equal(list.data.length, 1);
  const id = list.data[0].id;

  const approve = await call(env, 'POST', `/v1/admin/access-requests/${id}/approve`, { headers: adminHeaders });
  assert.equal(approve.status, 200);
  assert.equal(approve.data.object_exists, true);
  assert.match(approve.data.download_url, /^https:\/\/api\.stac\.test\/v1\/download\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const expiresIn = Date.parse(approve.data.expires_at) - Date.now();
  assert.ok(expiresIn > 6.9 * 86400000 && expiresIn <= 7 * 86400000);

  const path = new URL(approve.data.download_url).pathname;
  const dl = await call(env, 'GET', path);
  assert.equal(dl.status, 200);
  assert.equal(dl.text, 'PDF-CONTENT-123');
  assert.equal(dl.headers.get('Content-Type'), 'application/pdf');
  assert.match(dl.headers.get('Content-Disposition'), /attachment; filename="manual v2\.pdf"; filename\*=UTF-8''manual%20v2\.pdf/);
  const logged = env.DB.query(`SELECT * FROM events WHERE type = 'download'`);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].instrument_id, 'restricted-test');
  assert.equal(logged[0].file_path, 'manual v2.pdf');

  // Tampered: change the payload, keep the signature.
  const token = path.split('/').pop();
  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), k: 'restricted-test/other.pdf' })).toString('base64url');
  const tampered = await call(env, 'GET', `/v1/download/${forged}.${sig}`);
  assert.equal(tampered.status, 403);
  assert.equal(tampered.data.error.code, 'invalid_token');
  const garbage = await call(env, 'GET', '/v1/download/abc');
  assert.equal(garbage.status, 403);

  // Expired: correctly signed but in the past.
  const expired = await signDownloadToken(env, { requestId: id, key: 'restricted-test/manual v2.pdf', expiresAt: Math.floor(Date.now() / 1000) - 10 });
  const exp = await call(env, 'GET', `/v1/download/${expired}`);
  assert.equal(exp.status, 410);
  assert.equal(exp.data.error.code, 'token_expired');

  // Revoked: deny after approval invalidates the still-unexpired link.
  assert.equal((await call(env, 'POST', `/v1/admin/access-requests/${id}/deny`, { headers: adminHeaders })).status, 200);
  const revoked = await call(env, 'GET', path);
  assert.equal(revoked.status, 403);
  assert.equal(revoked.data.error.code, 'access_revoked');
});

test('access request without file_path requires the admin to choose one on approval', async () => {
  const env = makeEnv();
  await call(env, 'POST', '/v1/access-requests', {
    body: {
      instrument_id: 'restricted-test',
      name: 'Researcher',
      email: 'r@uni.example',
      institution: 'Uni',
      purpose: 'Replication of a published creativity study.',
      intended_use: 'other',
      turnstile_token: 't',
    },
  });
  const [{ id }] = env.DB.query('SELECT id FROM access_requests');
  const noFile = await call(env, 'POST', `/v1/admin/access-requests/${id}/approve`, { headers: adminHeaders });
  assert.equal(noFile.status, 400);
  const withFile = await call(env, 'POST', `/v1/admin/access-requests/${id}/approve`, {
    headers: adminHeaders,
    body: { file_path: 'scoring/key.xlsx' },
  });
  assert.equal(withFile.status, 200);
  assert.equal(withFile.data.file_key, 'restricted-test/scoring/key.xlsx');
  assert.equal(withFile.data.object_exists, false);
  const dl = await call(env, 'GET', new URL(withFile.data.download_url).pathname);
  assert.equal(dl.status, 404);
});

test('admin routes require auth: bearer token or valid Cloudflare Access JWT', async () => {
  const env = makeEnv();
  const routes = [
    ['GET', '/v1/admin/log'],
    ['GET', '/v1/admin/messages?status=pending'],
    ['POST', '/v1/admin/messages/1/approve'],
    ['GET', '/v1/admin/access-requests'],
    ['POST', '/v1/admin/access-requests/1/approve'],
    ['POST', '/v1/admin/access-requests/1/deny'],
  ];
  for (const [method, path] of routes) {
    const res = await call(env, method, path);
    assert.equal(res.status, 401, `${method} ${path}`);
    assert.equal(res.data.error.code, 'unauthorized');
  }
  const wrong = await call(env, 'GET', '/v1/admin/log', { headers: { Authorization: 'Bearer nope' } });
  assert.equal(wrong.status, 401);
  assert.equal((await call(env, 'GET', '/v1/admin/log', { headers: adminHeaders })).status, 200);

  const jwt = await makeAccessJwt();
  const viaAccess = await call(env, 'GET', '/v1/admin/messages', { headers: { 'Cf-Access-Jwt-Assertion': jwt } });
  assert.equal(viaAccess.status, 200);
  const wrongAud = await call(env, 'GET', '/v1/admin/messages', { headers: { 'Cf-Access-Jwt-Assertion': await makeAccessJwt({ aud: ['other'] }) } });
  assert.equal(wrongAud.status, 401);
  const expired = await call(env, 'GET', '/v1/admin/messages', {
    headers: { 'Cf-Access-Jwt-Assertion': await makeAccessJwt({ exp: Math.floor(Date.now() / 1000) - 3600 }) },
  });
  assert.equal(expired.status, 401);
  const badIss = await call(env, 'GET', '/v1/admin/messages', { headers: { 'Cf-Access-Jwt-Assertion': await makeAccessJwt({ iss: 'https://evil.example' }) } });
  assert.equal(badIss.status, 401);
  const forgedSig = `${jwt.slice(0, jwt.lastIndexOf('.'))}.${b64url('x'.repeat(256))}`;
  assert.equal((await call(env, 'GET', '/v1/admin/messages', { headers: { 'Cf-Access-Jwt-Assertion': forgedSig } })).status, 401);

  // Bearer path disabled when ADMIN_TOKEN is not configured.
  const noToken = makeEnv({ ADMIN_TOKEN: undefined });
  assert.equal((await call(noToken, 'GET', '/v1/admin/log', { headers: adminHeaders })).status, 401);

  // The moderator identity from the JWT is recorded.
  await call(env, 'POST', '/v1/messages', { body: { kind: 'public', subject: 'Hi all', body: 'Public hello', turnstile_token: 't' } });
  const [{ id }] = env.DB.query('SELECT id FROM messages');
  await call(env, 'POST', `/v1/admin/messages/${id}/approve`, { headers: { 'Cf-Access-Jwt-Assertion': jwt } });
  assert.equal(env.DB.query('SELECT moderated_by FROM messages')[0].moderated_by, 'moderator@example.org');
});

test('admin log filters and CSV export', async () => {
  const env = makeEnv();
  await call(env, 'POST', '/v1/events', { body: event('view', 'aut') });
  await call(env, 'POST', '/v1/events', { body: event('download', 'aut', { file_path: '=cmd.pdf' }) });
  await call(env, 'POST', '/v1/events', { body: event('view', 'dat-task') });

  const filtered = await call(env, 'GET', `/v1/admin/log?type=view&instrument_id=aut&since=${utcDay()}&until=${utcDay()}`, { headers: adminHeaders });
  assert.equal(filtered.data.length, 1);
  assert.equal(filtered.headers.get('X-Truncated'), 'false');
  const limited = await call(env, 'GET', '/v1/admin/log?limit=2', { headers: adminHeaders });
  assert.equal(limited.data.length, 2);
  assert.equal(limited.headers.get('X-Truncated'), 'true');
  const future = await call(env, 'GET', `/v1/admin/log?since=${addDays(utcDay(), 1)}`, { headers: adminHeaders });
  assert.equal(future.data.length, 0);
  assert.equal((await call(env, 'GET', '/v1/admin/log?since=yesterday', { headers: adminHeaders })).status, 400);

  const csv = await call(env, 'GET', '/v1/admin/log?format=csv', { headers: adminHeaders });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('Content-Type'), /^text\/csv/);
  const lines = csv.text.trim().split('\r\n');
  assert.equal(lines[0], 'ts,type,instrument_id,file_path,visitor');
  assert.equal(lines.length, 4);
  assert.ok(csv.text.includes(",'=cmd.pdf,"), 'formula injection must be neutralized');
  assert.ok(!csv.text.includes(TEST_IP));
});

test('CORS: allowed origin gets headers, foreign origin is rejected, preflight handled', async () => {
  const env = makeEnv();
  const pre = await call(env, 'OPTIONS', '/v1/messages', {
    headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
  });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(pre.headers.get('Access-Control-Allow-Methods'), /POST/);
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /Content-Type/i);
  assert.equal(pre.headers.get('Vary'), 'Origin');

  const local = await call(env, 'GET', '/v1/health', { headers: { Origin: 'http://localhost:8000' } });
  assert.equal(local.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8000');

  const foreignPre = await call(env, 'OPTIONS', '/v1/messages', { headers: { Origin: 'https://evil.example' } });
  assert.equal(foreignPre.status, 403);
  assert.equal(foreignPre.headers.get('Access-Control-Allow-Origin'), null);

  const foreignPost = await call(env, 'POST', '/v1/events', { headers: { Origin: 'https://evil.example' }, body: event('view', 'aut') });
  assert.equal(foreignPost.status, 403);
  assert.equal(foreignPost.data.error.code, 'forbidden_origin');
  assert.equal(env.DB.query('SELECT COUNT(*) AS n FROM events')[0].n, 0);

  const nullOrigin = await call(env, 'GET', '/v1/stats/summary', { headers: { Origin: 'null' } });
  assert.equal(nullOrigin.status, 403);
});

test('missing configuration fails closed with 503', async () => {
  const env = makeEnv({ TURNSTILE_SECRET: undefined });
  const res = await call(env, 'POST', '/v1/messages', { body: { kind: 'private', subject: 'Hello', body: 'Body text', turnstile_token: 't' } });
  assert.equal(res.status, 503);
  assert.equal(res.data.error.code, 'not_configured');
  const noSecret = makeEnv({ PSEUDONYM_SECRET: undefined });
  assert.equal((await call(noSecret, 'POST', '/v1/events', { body: event('view', 'aut') })).status, 503);
});

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

// Silence the worker's own console output; keep ours.
const print = console.log.bind(console);
console.log = console.warn = console.error = () => {};

let passed = 0;
const failures = [];
const started = Date.now();
for (const { name, fn } of tests) {
  try {
    await fn();
    passed++;
    print(`ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    print(`FAIL ${name}`);
    print(`     ${String(err?.stack || err).split('\n').slice(0, 6).join('\n     ')}`);
  }
}
fetchStub.restore();
print(`\n${passed} passed, ${failures.length} failed, ${tests.length} total (${Date.now() - started} ms)`);
process.exit(failures.length ? 1 : 0);
