/* STAC backend client.
 * Talks to the Cloudflare Worker (worker/README.md) when config.backend.api_base
 * is set. Without a backend the site runs in static mode: counters fall back to
 * archived GitHub numbers and messages become prefilled GitHub issue links. */
(function () {
  "use strict";
  const STAC = (window.STAC = window.STAC || {});

  const api = (STAC.api = {
    base: "",
    repo: { owner: "stac-archive", name: "stac", branch: "main" },

    init(catalog) {
      api.base = ((catalog.backend && catalog.backend.api_base) || "").replace(/\/$/, "");
      api.repo = catalog.repo || api.repo;
      api.turnstileKey = (catalog.backend && catalog.backend.turnstile_site_key) || "";
    },

    get enabled() { return Boolean(api.base); },
    get repoUrl() { return `https://github.com/${api.repo.owner}/${api.repo.name}`; },

    /** Opt-in pseudonym: a random ID kept only in this browser. */
    optinId() { return STAC.store.get("optin", null); },
    setOptin(on) {
      if (on) {
        const id = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2) + Date.now();
        STAC.store.set("optin", id);
      } else {
        STAC.store.del("optin");
        STAC.store.del("history");
      }
    },
    /** Local display name for the opt-in ID (the server derives its own with a secret). */
    localPseudonym() {
      const id = api.optinId();
      if (!id) return null;
      const adj = ["curious", "bold", "quiet", "bright", "lucid", "nimble", "patient", "vivid", "gentle", "keen", "brisk", "calm", "witty", "deft", "sunny", "stellar"];
      const ani = ["otter", "heron", "lynx", "finch", "badger", "marten", "ibis", "gecko", "puffin", "orca", "wren", "fox", "koala", "tapir", "egret", "civet"];
      let h = 0;
      for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      return `${adj[h % 16]}-${ani[(h >>> 4) % 16]}-${(h >>> 8).toString(16).slice(0, 4)}`;
    },

    /** Record a usage event (view, preview, download, interest, fork_click, cite_copy). */
    track(type, instrument_id, file_path) {
      const optin_id = api.optinId();
      if (optin_id && ["download", "interest", "fork_click", "preview"].includes(type)) {
        const hist = STAC.store.get("history", []);
        hist.unshift({ ts: new Date().toISOString(), type, instrument_id, file_path: file_path || null });
        STAC.store.set("history", hist.slice(0, 200));
      }
      if (!api.enabled) return;
      const body = JSON.stringify({ type, instrument_id, file_path, optin_id: optin_id || undefined });
      try {
        if (navigator.sendBeacon) navigator.sendBeacon(api.base + "/v1/events", new Blob([body], { type: "text/plain" }));
        else fetch(api.base + "/v1/events", { method: "POST", body, keepalive: true, headers: { "Content-Type": "text/plain" } });
      } catch { /* counting must never break the page */ }
    },

    async getJSON(path) {
      const r = await fetch(api.base + path, { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },

    async liveStats() { return api.enabled ? api.getJSON("/v1/stats/summary") : null; },
    async board(instrumentId) {
      if (!api.enabled) return null;
      return api.getJSON("/v1/board" + (instrumentId ? `?instrument_id=${encodeURIComponent(instrumentId)}` : ""));
    },

    /** POST a message or access request. The worker answers 201 {ok, ticket}. */
    async post(path, payload) {
      const r = await fetch(api.base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((data.error && data.error.message) || `Request failed (${r.status})`);
      return data;
    },

    /** Prefilled GitHub issue form URL (field ids from .github/ISSUE_TEMPLATE). */
    issueUrl(template, title, fields = {}) {
      const p = new URLSearchParams({ template, title });
      Object.entries(fields).forEach(([k, v]) => { if (v) p.set(k, v); });
      return `${api.repoUrl}/issues/new?${p.toString()}`;
    },
    discussionsUrl(category) {
      return `${api.repoUrl}/discussions${category ? "/categories/" + category : ""}`;
    },
    forkUrl() { return `${api.repoUrl}/fork`; },
    releaseBundleUrl(id) { return `${api.repoUrl}/releases/latest/download/${encodeURIComponent(id)}.zip`; }
  });
})();
