-- ---------------------------------------------------------------------------
-- STAC API: Cloudflare D1 schema
--
-- Apply with:
--   npx wrangler d1 execute stac-db --remote --file=./schema.sql
--
-- Privacy invariant: no table has a column for IP addresses, user agents,
-- cookies or any other raw client identifier. Visitors appear only as
--   * visitor_hash: HMAC of (UTC day, IP, user agent); rotates every day
--   * pseudonym:    HMAC of a random opt-in UUID the visitor chose to keep
-- Email addresses are stored ONLY in messages/access_requests and are never
-- returned by a public endpoint.
-- ---------------------------------------------------------------------------

-- Raw interaction events. Purged after RAW_RETENTION_DAYS (default 90) once
-- they have been folded into daily_aggregates by the nightly cron job.
CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT    NOT NULL,  -- ISO 8601 UTC timestamp, server-assigned
  day           TEXT    NOT NULL,  -- YYYY-MM-DD (UTC), denormalized for grouping
  type          TEXT    NOT NULL CHECK (type IN ('view', 'download', 'preview', 'interest', 'fork_click', 'cite_copy')),
  instrument_id TEXT    NOT NULL,
  file_path     TEXT,              -- optional, relative to the instrument folder
  visitor_hash  TEXT    NOT NULL,  -- 16 hex chars, daily-rotating pseudonym
  pseudonym     TEXT               -- 16 hex chars, only for opted-in visitors
);
CREATE INDEX IF NOT EXISTS idx_events_day            ON events (day);
CREATE INDEX IF NOT EXISTS idx_events_ts             ON events (ts);
CREATE INDEX IF NOT EXISTS idx_events_instrument_day ON events (instrument_id, day);

-- Long-term counters. One row per (day, instrument, file, type).
-- file_path is '' (not NULL) when the event had no file, so it can be part of
-- the primary key.
CREATE TABLE IF NOT EXISTS daily_aggregates (
  day           TEXT    NOT NULL,
  instrument_id TEXT    NOT NULL,
  file_path     TEXT    NOT NULL DEFAULT '',
  type          TEXT    NOT NULL,
  events        INTEGER NOT NULL DEFAULT 0,  -- number of events
  visitors      INTEGER NOT NULL DEFAULT 0,  -- distinct daily visitor hashes
  PRIMARY KEY (day, instrument_id, file_path, type)
);
CREATE INDEX IF NOT EXISTS idx_agg_instrument_day ON daily_aggregates (instrument_id, day);

-- Small key/value store. Key 'aggregated_through' holds the last UTC day that
-- has been folded into daily_aggregates. Stats read aggregates up to that day
-- and raw events after it, so nothing is ever counted twice.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Messages from the website (no GitHub account needed).
--   visibility = 'private' -> forwarded to the private inbox repo as an issue
--                 status: stored | forwarded | forward_failed
--   visibility = 'public'  -> moderation queue
--                 status: pending | approved | rejected
CREATE TABLE IF NOT EXISTS messages (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket              TEXT    NOT NULL UNIQUE,
  created_at          TEXT    NOT NULL,
  kind                TEXT    NOT NULL CHECK (kind IN ('private', 'public', 'error', 'missing', 'general')),
  visibility          TEXT    NOT NULL CHECK (visibility IN ('private', 'public')),
  status              TEXT    NOT NULL,
  instrument_id       TEXT,
  subject             TEXT    NOT NULL,
  body                TEXT    NOT NULL,
  name                TEXT,
  email               TEXT,            -- optional, NEVER published
  author_display      TEXT    NOT NULL, -- given name or generated pseudonym
  github_issue_number INTEGER,
  github_issue_url    TEXT,
  discussion_url      TEXT,
  moderated_at        TEXT,
  moderated_by        TEXT,
  moderation_note     TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages (status, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_board  ON messages (visibility, status, instrument_id, created_at);

-- Requests for restricted materials. Approval issues a signed, time-limited
-- download token bound to (request id, R2 object key). Denying a request
-- after approval revokes all of its tokens, because downloads re-check status.
CREATE TABLE IF NOT EXISTS access_requests (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket              TEXT    NOT NULL UNIQUE,
  created_at          TEXT    NOT NULL,
  instrument_id       TEXT    NOT NULL,
  file_path           TEXT,            -- as requested (may be NULL)
  name                TEXT    NOT NULL,
  email               TEXT    NOT NULL, -- NEVER published
  institution         TEXT    NOT NULL,
  purpose             TEXT    NOT NULL,
  intended_use        TEXT    NOT NULL CHECK (intended_use IN ('academic', 'commercial', 'other')),
  status              TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  forward_status      TEXT,            -- stored | forwarded | forward_failed
  github_issue_number INTEGER,
  github_issue_url    TEXT,
  approved_file_path  TEXT,            -- file the issued token is bound to
  token_expires_at    TEXT,
  decided_at          TEXT,
  decided_by          TEXT,
  decision_note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_access_status ON access_requests (status, created_at);

-- Fixed-window rate limit counters. bucket is e.g. 'ev:<visitor_hash>'.
-- Rows are purged by the nightly cron job once expired.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       TEXT    NOT NULL,
  window_start INTEGER NOT NULL,  -- window index (unix ms / window length)
  hits         INTEGER NOT NULL DEFAULT 0,
  expires_at   INTEGER NOT NULL,  -- unix ms when the window ends
  PRIMARY KEY (bucket, window_start)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits (expires_at);
