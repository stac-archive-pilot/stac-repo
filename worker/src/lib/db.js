/**
 * D1 access layer: rate limiting, event storage, statistics and nightly
 * maintenance. All SQL lives here so handlers stay readable.
 *
 * D1 API used: db.prepare(sql).bind(...).run()/all()/first(col?), db.batch([...]).
 * A batch runs as a single implicit transaction and costs one round trip.
 */

import { HttpError } from './http.js';
import {
  EVENT_TYPES,
  FILE_TYPES,
  INSTRUMENT_TYPES,
  TIMESERIES_DAYS,
  TIMESERIES_TYPES,
  TYPE_TO_KEY,
} from './constants.js';
import { addDays, utcDay } from './time.js';

// ---------------------------------------------------------------------------
// Rate limiting (fixed windows in table rate_limits)
//
// Why D1 and not memory: Workers isolates are short-lived and many run in
// parallel, so an in-memory counter would only limit a fraction of the
// traffic. D1 costs one extra write per request, which is fine at STAC's
// scale. If traffic ever grows a lot, switch to the Workers Rate Limiting
// binding or a Durable Object.
// ---------------------------------------------------------------------------

const UPSERT_RATE = `
INSERT INTO rate_limits (bucket, window_start, hits, expires_at)
VALUES (?1, ?2, 1, ?3)
ON CONFLICT (bucket, window_start) DO UPDATE SET hits = hits + 1
RETURNING hits`;

function windowFor(rule, nowMs) {
  const lengthMs = rule.windowSec * 1000;
  const windowStart = Math.floor(nowMs / lengthMs);
  const expiresAt = (windowStart + 1) * lengthMs;
  return { windowStart, expiresAt, retryAfter: Math.max(1, Math.ceil((expiresAt - nowMs) / 1000)) };
}

function rateLimited(retryAfter) {
  return new HttpError(429, 'rate_limited', 'Too many requests, please slow down', {
    'Retry-After': String(retryAfter),
  });
}

/** Count one hit in `bucket`; throw 429 when the window's limit is exceeded. */
export async function enforceRateLimit(db, bucket, rule, nowMs = Date.now()) {
  const w = windowFor(rule, nowMs);
  const hits = await db.prepare(UPSERT_RATE).bind(bucket, w.windowStart, w.expiresAt).first('hits');
  if (hits > rule.limit) throw rateLimited(w.retryAfter);
}

/**
 * Store an event unless the visitor is over the event rate limit.
 * Counter update and conditional insert run in ONE batch (one round trip,
 * one transaction). Throws 429 when limited.
 *
 * @param {object} ev {ts, day, type, instrumentId, filePath, visitorHash, pseudonym}
 */
export async function insertEventRateLimited(db, ev, rule, nowMs = Date.now()) {
  const w = windowFor(rule, nowMs);
  const bucket = `ev:${ev.visitorHash}`;
  const [counter] = await db.batch([
    db.prepare(UPSERT_RATE).bind(bucket, w.windowStart, w.expiresAt),
    db
      .prepare(
        `INSERT INTO events (ts, day, type, instrument_id, file_path, visitor_hash, pseudonym)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
         WHERE (SELECT hits FROM rate_limits WHERE bucket = ?8 AND window_start = ?9) <= ?10`,
      )
      .bind(
        ev.ts,
        ev.day,
        ev.type,
        ev.instrumentId,
        ev.filePath ?? null,
        ev.visitorHash,
        ev.pseudonym ?? null,
        bucket,
        w.windowStart,
        rule.limit,
      ),
  ]);
  const hits = counter?.results?.[0]?.hits ?? 0;
  if (hits > rule.limit) throw rateLimited(w.retryAfter);
}

/** Store an event without rate limiting (used for token downloads). */
export async function insertEvent(db, ev) {
  await db
    .prepare(
      `INSERT INTO events (ts, day, type, instrument_id, file_path, visitor_hash, pseudonym)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
    .bind(ev.ts, ev.day, ev.type, ev.instrumentId, ev.filePath ?? null, ev.visitorHash, ev.pseudonym ?? null)
    .run();
}

// ---------------------------------------------------------------------------
// Statistics
//
// Source of truth = daily_aggregates for days <= watermark
//                 + raw events      for days >  watermark
// where watermark = meta.aggregated_through (set by the cron job). This
// union never double-counts and keeps counters forever even though raw
// events are purged after RAW_RETENTION_DAYS.
// ---------------------------------------------------------------------------

const WATERMARK = `(SELECT COALESCE((SELECT value FROM meta WHERE key = 'aggregated_through'), '0000-00-00'))`;

/** CTE "src" with columns (day, instrument_id, file_path, type, n); ?1 = instrument id or NULL. */
const SRC_CTE = `
WITH src AS (
  SELECT day, instrument_id, file_path, type, events AS n
  FROM daily_aggregates
  WHERE day <= ${WATERMARK} AND (?1 IS NULL OR instrument_id = ?1)
  UNION ALL
  SELECT day, instrument_id, COALESCE(file_path, '') AS file_path, type, COUNT(*) AS n
  FROM events
  WHERE day > ${WATERMARK} AND (?1 IS NULL OR instrument_id = ?1)
  GROUP BY day, instrument_id, COALESCE(file_path, ''), type
)`;

const sqlList = (values) => values.map((v) => `'${v}'`).join(', '); // constants only, never user input

function emptyCounts(types) {
  return Object.fromEntries(types.map((t) => [TYPE_TO_KEY[t], 0]));
}

/**
 * Build the stats payload.
 * @param {D1Database} db
 * @param {string|null} instrumentId restrict to one instrument (adds by_file)
 */
export async function buildStats(db, instrumentId = null, now = new Date()) {
  const today = utcDay(now);
  const firstDay = addDays(today, -(TIMESERIES_DAYS - 1));
  const id = instrumentId ?? null;

  const statements = [
    db.prepare(`${SRC_CTE} SELECT type, SUM(n) AS n FROM src GROUP BY type`).bind(id),
    db
      .prepare(
        `${SRC_CTE} SELECT instrument_id, type, SUM(n) AS n FROM src
         WHERE type IN (${sqlList(INSTRUMENT_TYPES)}) GROUP BY instrument_id, type`,
      )
      .bind(id),
    db
      .prepare(
        `${SRC_CTE} SELECT day, type, SUM(n) AS n FROM src
         WHERE day >= ?2 AND type IN (${sqlList(TIMESERIES_TYPES)}) GROUP BY day, type`,
      )
      .bind(id, firstDay),
  ];
  if (instrumentId) {
    statements.push(
      db
        .prepare(
          `${SRC_CTE} SELECT file_path, type, SUM(n) AS n FROM src
           WHERE file_path <> '' AND type IN (${sqlList(FILE_TYPES)}) GROUP BY file_path, type`,
        )
        .bind(id),
    );
  }
  const [totalsRes, instRes, seriesRes, fileRes] = await db.batch(statements);

  const totals = emptyCounts(EVENT_TYPES);
  for (const row of totalsRes.results) {
    if (TYPE_TO_KEY[row.type]) totals[TYPE_TO_KEY[row.type]] = Number(row.n);
  }

  const byInstrument = {};
  for (const row of instRes.results) {
    byInstrument[row.instrument_id] ??= emptyCounts(INSTRUMENT_TYPES);
    byInstrument[row.instrument_id][TYPE_TO_KEY[row.type]] = Number(row.n);
  }
  if (instrumentId && !byInstrument[instrumentId]) byInstrument[instrumentId] = emptyCounts(INSTRUMENT_TYPES);

  // Contiguous series (zero-filled) so the frontend can chart it directly.
  const seriesMap = new Map();
  for (let i = 0; i < TIMESERIES_DAYS; i++) {
    const day = addDays(firstDay, i);
    seriesMap.set(day, { date: day, ...emptyCounts(TIMESERIES_TYPES) });
  }
  for (const row of seriesRes.results) {
    const point = seriesMap.get(row.day);
    if (point) point[TYPE_TO_KEY[row.type]] = Number(row.n);
  }

  const result = {
    updated_at: now.toISOString(),
    totals,
    by_instrument: byInstrument,
    timeseries: [...seriesMap.values()],
  };

  if (instrumentId) {
    const byFile = {};
    for (const row of fileRes.results) {
      byFile[row.file_path] ??= emptyCounts(FILE_TYPES);
      byFile[row.file_path][TYPE_TO_KEY[row.type]] = Number(row.n);
    }
    result.instrument_id = instrumentId;
    result.by_file = byFile;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Nightly maintenance (cron)
// ---------------------------------------------------------------------------

/**
 * 1. Fold all complete days after the watermark (up to yesterday) into
 *    daily_aggregates and advance the watermark, atomically.
 * 2. Purge raw events older than the retention window, but never events
 *    that have not been aggregated yet.
 * 3. Purge expired rate-limit rows.
 */
export async function runMaintenance(db, { retentionDays, now = new Date() }) {
  const today = utcDay(now);
  const yesterday = addDays(today, -1);
  const watermark =
    (await db.prepare(`SELECT value FROM meta WHERE key = 'aggregated_through'`).first('value')) || '0000-00-00';

  let aggregatedThrough = watermark;
  if (watermark < yesterday) {
    await db.batch([
      db
        .prepare(
          `INSERT INTO daily_aggregates (day, instrument_id, file_path, type, events, visitors)
           SELECT day, instrument_id, COALESCE(file_path, ''), type, COUNT(*), COUNT(DISTINCT visitor_hash)
           FROM events
           WHERE day > ?1 AND day <= ?2
           GROUP BY day, instrument_id, COALESCE(file_path, ''), type
           ON CONFLICT (day, instrument_id, file_path, type)
           DO UPDATE SET events = excluded.events, visitors = excluded.visitors`,
        )
        .bind(watermark, yesterday),
      db
        .prepare(
          `INSERT INTO meta (key, value) VALUES ('aggregated_through', ?1)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        )
        .bind(yesterday),
    ]);
    aggregatedThrough = yesterday;
  }

  const cutoff = addDays(today, -retentionDays);
  const purgedEvents = await db
    .prepare(`DELETE FROM events WHERE day < ?1 AND day <= ?2`)
    .bind(cutoff, aggregatedThrough)
    .run();
  const purgedRates = await db.prepare(`DELETE FROM rate_limits WHERE expires_at < ?1`).bind(now.getTime()).run();

  return {
    aggregated_through: aggregatedThrough,
    purged_events: purgedEvents.meta?.changes ?? 0,
    purged_rate_limits: purgedRates.meta?.changes ?? 0,
  };
}
