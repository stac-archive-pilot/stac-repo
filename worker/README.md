# STAC API (Cloudflare Worker)

A small serverless backend for the static STAC archive website (Scales and Tasks for Art and Creativity Assessment). The website itself is a static GitHub Pages SPA; this Worker provides the few things GitHub cannot:

- **Long-term counters** for views, previews, downloads and other interactions per instrument and per file (GitHub traffic data only covers 14 days).
- **Messages without a GitHub account**: private messages, anonymous error reports and "missing material" notes land as issues in a **private** inbox repository.
- **Moderated public messages** from people without a GitHub account (moderation queue, public board, optional mirror to GitHub Discussions).
- **Access requests** for restricted materials, with signed, **time-limited download links** served from a private R2 bucket.
- A **pseudonymized activity log** ("Protokoll") for admins (JSON or CSV).

Stack: Cloudflare Workers (plain JavaScript ES modules, no build step, no runtime dependencies), D1 (SQLite), optional R2, Turnstile, optional Cloudflare Access.

## Files

| Path | Purpose |
| --- | --- |
| `src/index.js` | Entry point: router, CORS, error handling, cron handler |
| `src/handlers/*.js` | Endpoint handlers (events, stats, messages, access, admin) |
| `src/lib/*.js` | Helpers: crypto, pseudonyms, validation, D1 queries, GitHub, Turnstile, Access JWT, download tokens, CORS, HTTP |
| `schema.sql` | D1 schema (tables and indices) |
| `wrangler.toml` | Worker configuration with placeholders |
| `test/run-tests.mjs` | Dependency-free test suite (`node test/run-tests.mjs`, Node 22+) |
| `test/fakes.mjs` | In-memory D1 (via built-in `node:sqlite`), fake R2, fetch stub |
| `.dev.vars.example` | Template for local secrets used by `wrangler dev` |

## API (v1)

Base URL: wherever the Worker is deployed (e.g. `https://api.example.org`). All bodies are JSON. All errors have the shape:

```json
{ "error": { "code": "validation_failed", "message": "instrument_id: must match ^[a-z0-9-]{2,120}$" } }
```

### Public endpoints

| Method | Path | Protection | Response |
| --- | --- | --- | --- |
| `GET` | `/v1/health` | none | `{ok, service, api_version, time, checks: {db, r2}}` |
| `POST` | `/v1/events` | rate limit (120 / 10 min / visitor) | `204` |
| `GET` | `/v1/stats/summary` | cached 5 min | stats object (see below) |
| `GET` | `/v1/stats/instrument/:id` | cached 5 min | stats object + `instrument_id`, `by_file` |
| `POST` | `/v1/messages` | Turnstile + rate limit (10 / h / visitor) | `201 {ok: true, ticket: "STAC-XXXXXX"}` |
| `GET` | `/v1/board?instrument_id=&limit=` | cached 60 s | array of approved public messages |
| `POST` | `/v1/access-requests` | Turnstile + rate limit (shared with messages) | `201 {ok: true, ticket: "STAC-XXXXXX"}` |
| `GET` | `/v1/download/:token` | signed token, 30 downloads / 10 min / request | file stream (attachment) |

**`POST /v1/events`** body:

```json
{ "type": "view", "instrument_id": "alternate-uses-task", "file_path": "materials/form-a.pdf", "optin_id": "<uuid>" }
```

- `type`: `view | download | preview | interest | fork_click | cite_copy`
- `instrument_id`: `^[a-z0-9-]{2,120}$`
- `file_path` (optional): relative path, max 300 chars, no `..`, no leading `/`, no backslash
- `optin_id` (optional): a random UUID the visitor **opted in** to keep in local storage
- Accepts `Content-Type: application/json` **or** `text/plain` (so `navigator.sendBeacon(url, JSON.stringify(body))` works without a CORS preflight). Max 4 KB.

**Stats object**:

```json
{
  "updated_at": "2026-10-22T08:00:00.000Z",
  "totals": { "views": 0, "downloads": 0, "previews": 0, "interest": 0, "fork_clicks": 0, "cite_copies": 0 },
  "by_instrument": { "<id>": { "views": 0, "downloads": 0, "previews": 0, "interest": 0 } },
  "timeseries": [ { "date": "YYYY-MM-DD", "views": 0, "downloads": 0, "previews": 0 } ]
}
```

`timeseries` always has exactly 365 entries (oldest first, today last, zero-filled). The instrument endpoint returns the same shape restricted to that instrument (`by_instrument` has one key) plus `instrument_id` and `by_file: {"<file_path>": {downloads, previews}}`. Unknown instruments return zeros, not 404 (the Worker does not know the catalog).

**`POST /v1/messages`** body:

```json
{
  "kind": "private | public | error | missing | general",
  "instrument_id": "optional-id",
  "subject": "3-200 chars",
  "body": "5-5000 chars",
  "name": "optional, max 100 chars, must not contain @",
  "email": "optional",
  "visibility": "private | public (only used for kind=general)",
  "optin_id": "optional uuid (used for the pseudonymous author name)",
  "turnstile_token": "..."
}
```

Routing:

| kind | Goes to |
| --- | --- |
| `private`, `error`, `missing` | always private: D1 row + issue in the private `INBOX_REPO` |
| `public` | always public: D1 row with status `pending` (moderation queue) |
| `general` | follows `visibility`, default `private` |

If GitHub is unreachable, the message is still stored (status `forward_failed`) and the visitor still gets `{ok: true, ticket}`; admins find it via `GET /v1/admin/messages?status=forward_failed`.

**`GET /v1/board`** returns `[{id, created_at, instrument_id, subject, body, author_display, discussion_url}]`, newest first, default 200 (max 500). `author_display` is the given name or a generated pseudonym such as `curious-otter-3f9a`; email is never part of this response.

**`POST /v1/access-requests`** body:

```json
{
  "instrument_id": "required",
  "file_path": "optional",
  "name": "required",
  "email": "required",
  "institution": "2-200 chars",
  "purpose": "20-3000 chars",
  "intended_use": "academic | commercial | other",
  "turnstile_token": "..."
}
```

Creates a D1 row and an issue labelled `access-request` in the inbox repo.

**`GET /v1/download/:token`** verifies the HMAC signature and expiry, re-checks that the access request is still `approved` and bound to the same file, streams `RESTRICTED/<instrument_id>/<file_path>` and logs a `download` event. Errors: `403 invalid_token`, `410 token_expired`, `403 access_revoked`, `404 not_found`, `503 not_configured` (no R2 binding).

### Admin endpoints

Authentication, either of:

1. **Cloudflare Access** (humans): protect the admin path or an admin hostname with an Access application. Cloudflare adds `Cf-Access-Jwt-Assertion`; the Worker verifies it (RS256, JWKS from `https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`, audience `ACCESS_AUD`, issuer, expiry). The JWT's `email` is recorded as moderator.
2. **`Authorization: Bearer <ADMIN_TOKEN>`** (scripts). Disabled when `ADMIN_TOKEN` is unset.

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `GET` | `/v1/admin/log?since=&until=&type=&instrument_id=&limit=&format=json\|csv` | | array of `{ts, type, instrument_id, file_path, visitor}`; header `X-Truncated: true\|false` |
| `GET` | `/v1/admin/messages?status=` | | array of messages incl. email (status optional; omitted = all) |
| `POST` | `/v1/admin/messages/:id/approve` | `{note?, publish_discussion?: true}` | `{ok, id, ticket, status, discussion_url}` (+ `discussion_error` if the mirror failed) |
| `POST` | `/v1/admin/messages/:id/reject` | `{note?}` | `{ok, id, ticket, status, discussion_url}` |
| `GET` | `/v1/admin/access-requests?status=` | | array of access requests |
| `POST` | `/v1/admin/access-requests/:id/approve` | `{file_path?, note?}` | `{ok, id, ticket, file_key, download_url, expires_at, object_exists}` |
| `POST` | `/v1/admin/access-requests/:id/deny` | `{note?}` | `{ok, id, status: "denied"}` |

Notes:

- `since`/`until` take `YYYY-MM-DD` (until is inclusive of that whole day) or a full ISO timestamp. `limit` defaults to 5000 (max 50000). The log only covers raw events still within the retention window.
- `visitor` is the opt-in display name (e.g. `curious-otter-3f9a`) or `anon-` plus the first 6 hex chars of the daily visitor hash.
- Message statuses: public `pending | approved | rejected`; private `stored | forwarded | forward_failed`. Approve works from `pending` or `rejected`, reject from `pending` or `approved` (to unpublish). A message is mirrored to Discussions at most once.
- Access approval: if the request did not name a file, pass `file_path`. The link is valid for `DOWNLOAD_TTL_DAYS` (default 7). Approving again issues a fresh link. **Deny revokes** all links of that request immediately. The Worker does not send email; send the link to the requester yourself.

Example:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" "https://api.example.org/v1/admin/log?since=2026-10-01&format=csv" -o log.csv
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://api.example.org/v1/admin/messages/12/approve
```

## Privacy design

**Stored**

| Data | Where | Retention |
| --- | --- | --- |
| Raw events: timestamp, type, instrument, file, `visitor_hash`, optional `pseudonym` | `events` | `RAW_RETENTION_DAYS` (default 90), then deleted |
| Daily counters per instrument/file/type (event count, distinct daily visitors) | `daily_aggregates` | indefinitely (contains no identifiers) |
| Rate-limit counters keyed by daily visitor hash | `rate_limits` | deleted nightly once the window has expired |
| Messages (subject, body, optional name and email) | `messages` and, for private ones, the private inbox repo | until deleted by admins (see below) |
| Access requests (name, email, institution, purpose) | `access_requests` and the private inbox repo | until deleted by admins |

**Never stored**: IP addresses, user-agent strings, cookies, referrers, fingerprints. IP and user agent are used in memory only, to compute the daily visitor hash and (for forms) to pass the IP to Turnstile's siteverify, which is how Cloudflare recommends using Turnstile.

**Never published**: email addresses. The public board and Discussions only show `author_display`. A `name` containing `@` is rejected so an email cannot be published by accident. Issue bodies render visitor text inside fenced code blocks and neutralize `@mentions`.

**Daily salt rationale**: `visitor_hash = first 16 hex of HMAC-SHA256(PSEUDONYM_SECRET, "YYYY-MM-DD|ip|user-agent")`.

- The **secret key** prevents reversing the hash. A plain SHA-256 of an IPv4 address can be brute-forced in minutes because there are only about 4 billion addresses.
- The **UTC date** in the input makes the hash change every day, so a visitor can be counted once per day and rate-limited, but cannot be followed across days.
- **Truncation** to 64 bits is plenty for counting but reduces what the value carries.

**Opt-in pseudonym**: `pseudonym = first 16 hex of HMAC-SHA256(PSEUDONYM_SECRET, "optin:" + optin_id)`. Only if the visitor actively agrees, the frontend stores a random UUID locally and sends it with events. This deliberately links that visitor's events across days (that is what they agreed to); they can undo it by deleting the UUID. The display name (`curious-otter-3f9a`) is derived deterministically from the pseudonym.

**Secret rotation**: rotating `PSEUDONYM_SECRET` breaks continuity of opt-in pseudonyms and (unless `DOWNLOAD_TOKEN_SECRET` is set) invalidates all outstanding download links.

**GDPR note**: pseudonymized data is still personal data under the GDPR (Recital 26), and messages and access requests contain directly identifying data. Before going live you need:

- a **privacy notice** on the website describing these processing purposes, the data, retention, recipients (Cloudflare as processor, GitHub for the inbox repo) and data subject rights;
- a **legal basis** for each purpose, typically legitimate interest (Art. 6(1)(f)) for aggregate statistics and abuse protection, and consent for the opt-in pseudonym. Storing the opt-in UUID on the visitor's device additionally falls under the ePrivacy rules on terminal equipment (in Germany § 25 TDDDG), so ask before storing it;
- data processing agreements with Cloudflare and GitHub as applicable, and an entry in the records of processing activities;
- a retention policy for messages and access requests (they are not purged automatically).

This is not legal advice; involve your institution's data protection officer.

Deleting a person's data on request (by ticket):

```bash
npx wrangler d1 execute stac-db --remote --command "DELETE FROM messages WHERE ticket = 'STAC-XXXXXX'"
npx wrangler d1 execute stac-db --remote --command "UPDATE access_requests SET email = '[deleted]', name = '[deleted]' WHERE ticket = 'STAC-XXXXXX'"
```

Also close/delete the corresponding issue in the inbox repo.

## Deploy

Prerequisites: a Cloudflare account, Node.js, and `npx wrangler` (logged in with `npx wrangler login`).

1. **Create the D1 database** and put its id into `wrangler.toml` (`database_id`):

   ```bash
   npx wrangler d1 create stac-db
   npx wrangler d1 execute stac-db --remote --file=./schema.sql
   ```

2. **Optional: R2 bucket for restricted files** (otherwise delete the `[[r2_buckets]]` block):

   ```bash
   npx wrangler r2 bucket create stac-restricted
   # object key = <instrument_id>/<file_path>
   npx wrangler r2 object put "stac-restricted/some-instrument/manual.pdf" --file=./manual.pdf --remote
   ```

3. **Turnstile**: create a widget in the Cloudflare dashboard for the site's hostname. The *site key* goes into the frontend, the *secret key* into the Worker. For local development Cloudflare documents test keys that always pass (see the Turnstile "testing" docs; `.dev.vars.example` uses the always-pass secret).

4. **GitHub**:
   - Create a **private** inbox repo (e.g. `stac-archive/stac-inbox`) and set `INBOX_REPO`. Pre-create the labels `private-message`, `error-report`, `missing-material`, `general-inquiry`, `access-request`, `via-stac-api`.
   - Create a **fine-grained token** (ideally owned by a bot account) restricted to the needed repositories with only: *Issues: Read and write* on the inbox repo, and *Discussions: Read and write* on the public repo (only if you mirror approved messages). Metadata read access is added automatically. If the two repos have different owners, use a second token in `GITHUB_DISCUSSIONS_TOKEN`.
   - Optional Discussions mirror: enable Discussions on the public repo and look up the GraphQL node ids:

     ```bash
     gh api graphql -f query='query { repository(owner: "OWNER", name: "REPO") { id discussionCategories(first: 20) { nodes { id name } } } }'
     ```

     Put them into `DISCUSSIONS_REPO_ID` and `DISCUSSIONS_CATEGORY_ID`.

5. **Secrets** (never commit them):

   ```bash
   openssl rand -hex 32 | npx wrangler secret put PSEUDONYM_SECRET
   npx wrangler secret put TURNSTILE_SECRET
   npx wrangler secret put GITHUB_TOKEN
   openssl rand -hex 32 | npx wrangler secret put ADMIN_TOKEN      # optional, for scripts
   # optional: DOWNLOAD_TOKEN_SECRET, GITHUB_DISCUSSIONS_TOKEN
   ```

6. **Variables** in `wrangler.toml`: `ALLOWED_ORIGINS` (exact origins of the website, comma-separated, e.g. `https://stac-archive.github.io,http://localhost:8000`), `RAW_RETENTION_DAYS`, `INBOX_REPO`, and optionally `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `PUBLIC_API_BASE`, `DOWNLOAD_TTL_DAYS`, `STATS_CACHE_SECONDS`.

7. **Optional: Cloudflare Access** for the admin UI: create a self-hosted Access application covering `/v1/admin/*` on the API hostname (or a dedicated admin hostname), allow the moderators' identities, and copy the application's *AUD tag* into `ACCESS_AUD` and your team domain (`<team>.cloudflareaccess.com`) into `ACCESS_TEAM_DOMAIN`.

8. **Deploy**: `npx wrangler deploy`. The cron trigger (`17 3 * * *`, UTC) aggregates and purges nightly. A custom domain is recommended, because the Cache API only takes effect on custom domains (the per-isolate memo cache works everywhere).

## Testing

```bash
node test/run-tests.mjs
```

Requires Node 22 or newer (uses the built-in `node:sqlite`, `fetch`, `Request`/`Response` and WebCrypto). No npm install. The suite runs the real `schema.sql` and every SQL statement against in-memory SQLite, stubs Turnstile, GitHub and the Cloudflare Access JWKS (with a real RSA key pair), and covers privacy invariants, validation, rate limits, stats and cron aggregation, inbox forwarding, moderation, access requests and token downloads, admin auth and CORS.

Local run against the Workers runtime: copy `.dev.vars.example` to `.dev.vars`, apply the schema locally (`npx wrangler d1 execute stac-db --local --file=./schema.sql`) and run `npx wrangler dev`.

## Design notes and caveats

- **CORS**: browser requests with an `Origin` not in `ALLOWED_ORIGINS` get `403 forbidden_origin` (including `Origin: null`). Requests without `Origin` (curl, servers, opening a download link) are allowed, because CORS cannot restrict them anyway; admin routes rely on authentication, form routes on Turnstile and rate limits.
- **Rate limits** are fixed windows counted in D1 (one extra write per request). An in-memory counter would not work reliably because Workers run many short-lived isolates. At much higher traffic, switch to the Workers Rate Limiting binding or a Durable Object.
- **Stats consistency**: stats read `daily_aggregates` up to the watermark `meta.aggregated_through` and raw events after it, so the nightly job never double-counts and counters survive the raw-event purge. Raw events that have not been aggregated are never purged.
- **Counts are event counts**, not unique visitors (aggregates also keep distinct daily visitors in `daily_aggregates.visitors` for later use). Reload spam is bounded by the per-visitor rate limit.
- **Stats caching**: up to `STATS_CACHE_SECONDS` (default 300) of staleness by design.

## Cost

For an archive of STAC's size the Cloudflare free tier (Workers requests, D1 reads/writes and storage, R2 storage, Turnstile) is typically enough. Limits and prices change, so check current Cloudflare pricing for Workers, D1 and R2 before relying on this.
