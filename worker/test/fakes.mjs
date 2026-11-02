/**
 * Test doubles for the Cloudflare bindings, dependency-free.
 *
 *  - createFakeD1: an in-memory D1 stand-in backed by Node's built-in
 *    `node:sqlite` (SQLite in ':memory:' mode). It implements the subset of
 *    the D1 API the worker uses: prepare(sql).bind(...).run()/all()/first(col?)
 *    and batch([...]) (transactional). Using real SQLite means schema.sql and
 *    every SQL statement in the worker are actually executed by the tests.
 *  - createFakeR2: a Map-backed R2 bucket with get/head/put.
 *  - createFetchStub: replaces globalThis.fetch and records every call.
 */

/**
 * @param {typeof import('node:sqlite').DatabaseSync} DatabaseSync
 * @param {string} schemaSql
 */
export function createFakeD1(DatabaseSync, schemaSql) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schemaSql);

  const returnsRows = (sql) => /^\s*(WITH|SELECT)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);

  function execute(sql, params) {
    const stmt = sqlite.prepare(sql);
    if (returnsRows(sql)) {
      const results = stmt.all(...params).map((row) => ({ ...row }));
      return { success: true, results, meta: { changes: results.length } };
    }
    const info = stmt.run(...params);
    return {
      success: true,
      results: [],
      meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
    };
  }

  class FakeStatement {
    constructor(sql, params = []) {
      this.sql = sql;
      this.params = params;
    }
    bind(...params) {
      // Like real D1: undefined is not a bindable value.
      params.forEach((p, i) => {
        if (p === undefined) throw new Error(`D1_TYPE_ERROR: undefined bound at position ${i + 1} in: ${this.sql}`);
      });
      return new FakeStatement(this.sql, params);
    }
    _exec() {
      return execute(this.sql, this.params);
    }
    async run() {
      return this._exec();
    }
    async all() {
      return this._exec();
    }
    async first(column) {
      const row = this._exec().results[0];
      if (!row) return null;
      return column === undefined ? row : (row[column] ?? null);
    }
  }

  return {
    prepare: (sql) => new FakeStatement(sql),
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const out = statements.map((s) => s._exec());
        sqlite.exec('COMMIT');
        return out;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    // ---- test helpers (not part of D1) ----
    query(sql, ...params) {
      return sqlite.prepare(sql).all(...params).map((r) => ({ ...r }));
    },
    tables() {
      return this.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).map(
        (r) => r.name,
      );
    },
    dumpAll() {
      return Object.fromEntries(this.tables().map((t) => [t, this.query(`SELECT * FROM ${t}`)]));
    },
  };
}

/** Map-backed R2 bucket. */
export function createFakeR2() {
  const objects = new Map();
  const meta = (key, o) => ({
    key,
    size: o.data.byteLength,
    httpEtag: `"etag-${key.length}-${o.data.byteLength}"`,
    writeHttpMetadata(headers) {
      if (o.contentType) headers.set('Content-Type', o.contentType);
    },
  });
  return {
    async put(key, data, opts = {}) {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      objects.set(key, { data: bytes, contentType: opts.httpMetadata?.contentType });
    },
    async head(key) {
      const o = objects.get(key);
      return o ? meta(key, o) : null;
    },
    async get(key) {
      const o = objects.get(key);
      if (!o) return null;
      return { ...meta(key, o), body: new Response(o.data).body };
    },
  };
}

/**
 * Replace globalThis.fetch with a router of fake upstreams.
 * @param {Array<[RegExp, (url: string, init: RequestInit) => Promise<Response>|Response]>} routes
 */
export function createFetchStub(routes) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, init });
    for (const [pattern, handler] of routes) {
      if (pattern.test(url)) return handler(url, init);
    }
    throw new Error(`Unexpected outbound fetch in test: ${url}`);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}
