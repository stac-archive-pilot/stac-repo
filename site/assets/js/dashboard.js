/* STAC dashboard: archive composition (real), legacy OSF downloads (real,
 * lower bounds from the paper), live counters (worker) and the admin activity
 * log. Without a backend the live parts can show clearly marked demo data. */
(function () {
  "use strict";
  const STAC = (window.STAC = window.STAC || {});
  const { esc, icon, fmt, fmtCompact } = STAC;

  let demo = STAC.store.get("demo", false);

  /** Seeded PRNG so demo data look the same on every visit. */
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function demoData(state) {
    const r = rng(42);
    const days = 120;
    const dates = [];
    const views = [], downloads = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 864e5);
      dates.push(d.toISOString().slice(0, 10));
      const weekday = d.getUTCDay() % 6 === 0 ? 0.55 : 1;
      const v = Math.round((140 + 40 * Math.sin(i / 9) + 60 * r()) * weekday);
      views.push(v);
      downloads.push(Math.round(v * (0.28 + 0.1 * r())));
    }
    const weights = state.items.map((it) => (it.legacy || 400) + 200);
    const total = weights.reduce((a, b) => a + b, 0);
    const pick = () => { let x = r() * total; for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x <= 0) return state.items[i]; } return state.items[0]; };
    const names = ["curious-otter-3f9a", "anon-7c21d0", "lucid-heron-a0b4", "anon-19fe33", "keen-lynx-5d12", "anon-b8e044", "brisk-wren-0c7e", "anon-2a9f61"];
    const types = ["view", "preview", "download", "download", "view", "cite_copy", "interest", "fork_click"];
    const log = Array.from({ length: 14 }, (_, i) => {
      const it = pick();
      const type = types[Math.floor(r() * types.length)];
      const f = it.files[Math.floor(r() * it.files.length)];
      return { ts: new Date(today.getTime() - (i * 23 + r() * 20) * 6e4).toISOString().slice(0, 16).replace("T", " "), type, instrument: it, file: ["download", "preview"].includes(type) ? f.name : "", visitor: names[Math.floor(r() * names.length)] };
    });
    return { dates, views, downloads, log };
  }

  function card(id, title, sub, extra = "") {
    return `<div class="chart-card"><h3>${esc(title)}</h3><p class="sub">${sub}</p>${extra}<div id="${id}"></div></div>`;
  }

  STAC.dashboard = {
    render(root, state) {
      const c = state.catalog;
      const t = c.totals;
      const st = state.stats || {};
      const legacy = st.legacy || {};
      const live = st.live || null;
      const gh = st.github || {};
      const flags = {};
      state.items.forEach((it) => [...it.quality.flags, ...it.quality.file_flags].forEach((f) => { flags[f] = (flags[f] || 0) + 1; }));

      root.innerHTML = `
        <div class="page-head" style="display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap;justify-content:space-between">
          <div><p class="eyebrow">Usage and archive health</p><h1>Dashboard</h1>
          <p>Archive composition and the migration audit are computed from the files. OSF download figures are the lower bounds reported in the STAC paper. Live counters start once the backend runs.</p></div>
          <label class="switch"><input type="checkbox" id="demo-toggle" ${demo ? "checked" : ""}> Show demo data for live panels</label>
        </div>

        <div class="kpis">
          <div class="kpi"><b>${fmt(t.instruments)}</b><span>instruments</span><small>${fmt(t.by_kind.scale || 0)} scales · ${fmt(t.by_kind.task || 0)} tasks · ${fmt(t.by_kind.method || 0)} methods</small></div>
          <div class="kpi"><b>${fmt(t.files)}</b><span>files</span><small>${esc(STAC.fmtBytes(t.bytes))} in total</small></div>
          <div class="kpi"><b>${fmt(t.languages)}</b><span>languages</span><small>English in ${fmt(t.by_language.en || 0)} instruments</small></div>
          <div class="kpi"><b>${fmt(t.added_on_github || 0)}</b><span>added since the OSF freeze</span><small>OSF snapshot: 90 instruments (Oct 2026)</small></div>
          <div class="kpi"><b>${fmt(t.survey_ready)}</b><span>ready to run</span><small>Qualtrics, MediaLab, PsychoPy or MATLAB files</small></div>
          <div class="kpi"><b>${legacy.total ? fmtCompact(legacy.total) + (legacy.kind === "lower-bound" ? "+" : "") : "–"}</b><span>downloads on OSF</span><small>${esc(legacy.kind === "lower-bound" ? "Lower bound, Kenett et al. (2026); keeps growing on the frozen OSF copy" : (legacy.source || "") + (legacy.fetched_at ? ", read " + legacy.fetched_at.slice(0, 10) : ""))}</small></div>
          <div class="kpi"><b>${live ? fmt(live.totals.downloads) : demo ? fmt(demoData(state).downloads.reduce((a, b) => a + b, 0)) : "–"}</b><span>downloads since launch</span><small>${live ? "Live counter" : demo ? '<span class="demo-flag">Demo data</span>' : "Starts with the backend"}</small></div>
        </div>

        <div class="cols-2">
          ${card("ch-legacy", "Most downloaded on OSF", "Lower bounds reported in the STAC paper (early 2026); colored by section.", `<div class="legend"><span><i style="background:var(--sec-art)"></i>Art and Aesthetics</span><span><i style="background:var(--sec-cre)"></i>Creativity</span><span><i style="background:var(--sec-pid)"></i>Personality and ID</span></div>`)}
          ${card("ch-formats", "Files by format", "All files in the archive, by extension.")}
        </div>

        <div class="chart-card">
          <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline">
            <div><h3>Views and downloads per day</h3><p class="sub">${live ? "Live counters from the backend (raw events, not unique visitors)." : demo ? "Synthetic example series. Real data appear once the backend runs." : "No live data yet."}</p></div>
            ${!live && demo ? '<span class="demo-flag">Demo data</span>' : ""}
          </div>
          <div id="ch-time"></div>
          <div class="legend" id="time-legend"></div>
        </div>

        <div class="cols-2">
          ${card("ch-langs", "Instruments per language", "An instrument counts once per language it is available in.")}
          ${card("ch-quality", "Metadata quality after migration", "Score from README completeness, file drift, languages, DOI, license check and file hygiene.")}
        </div>

        <div class="cols-2">
          <div class="chart-card"><h3>Migration audit</h3><p class="sub">Findings in the OSF archive (instruments or files affected). Nothing was changed in the authors' files; each item is a to-do for curators.</p>
            <table class="log-table"><tbody>${Object.entries(flags).filter(([f]) => f !== "hosted_in_repository").sort((a, b) => b[1] - a[1]).map(([f, n]) => `<tr><td class="mono" style="width:44px">${n}</td><td>${esc(STAC.flagLabel(f))}</td></tr>`).join("")}</tbody></table>
          </div>
          <div class="chart-card"><h3>GitHub</h3><p class="sub">Read daily by a scheduled workflow. GitHub keeps traffic only 14 days, so snapshots are archived on the stats branch.</p>
            <div class="kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))">
              <div class="kpi"><b>${gh.available ? fmt(gh.stars) : "–"}</b><span>stars</span></div>
              <div class="kpi"><b>${gh.available ? fmt(gh.forks) : "–"}</b><span>forks</span></div>
              <div class="kpi"><b>${gh.available ? fmt(gh.watchers) : "–"}</b><span>watchers</span></div>
              <div class="kpi"><b>${fmt(gh.traffic_snapshots || 0)}</b><span>traffic snapshots</span></div>
            </div>
            ${gh.available ? "" : '<p class="sub" style="margin-top:10px">Available once the repository is public on GitHub.</p>'}
          </div>
        </div>

        <div class="chart-card">
          <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline">
            <div><h3>Activity log</h3><p class="sub">Moderator view. Visitors appear as pseudonyms (opt-in) or as daily-rotating anonymous hashes; IP addresses are never stored.</p></div>
            <span>${!live && demo ? '<span class="demo-flag">Demo data</span>' : `<span class="badge b-silver">${icon("lock")}Moderators only</span>`}</span>
          </div>
          <div id="log" style="overflow-x:auto"></div>
        </div>`;

      // Legacy downloads (real numbers from the paper)
      const leg = Object.entries(legacy.by_instrument || {})
        .map(([id, n]) => ({ it: state.byId.get(id), n }))
        .filter((d) => d.it)
        .sort((a, b) => b.n - a.n)
        .map((d) => ({ label: d.it.display, value: d.n, valueLabel: `${fmt(d.n)}+`, color: STAC.SEC_COLOR[d.it.section], detail: d.it.title }));
      STAC.hbar(document.getElementById("ch-legacy"), leg, { title: "Most downloaded on OSF", labelWidth: 80 });

      const exts = Object.entries(t.by_ext).map(([k, v]) => ({ label: `.${k}`, value: v, detail: (c.formats[k] && c.formats[k].label) || "" }));
      STAC.hbar(document.getElementById("ch-formats"), exts, { title: "Files by format", labelWidth: 70 });

      const langs = Object.entries(t.by_language).map(([k, v]) => ({ label: c.facets.languages[k] || k, value: v }));
      STAC.hbar(document.getElementById("ch-langs"), langs, { title: "Instruments per language", labelWidth: 90, barH: 14 });

      const ql = ["gold", "silver", "bronze", "draft"].map((k, i) => ({
        label: { gold: "Gold 85+", silver: "Silver 65–84", bronze: "Bronze 45–64", draft: "Draft <45" }[k],
        value: t.quality[k] || 0,
        color: ["#1c5cab", "#2a78d6", "#5598e7", "#86b6ef"][i]
      }));
      STAC.hbar(document.getElementById("ch-quality"), ql, { title: "Metadata quality", labelWidth: 100 });

      // Time series
      const timeEl = document.getElementById("ch-time");
      const legend = document.getElementById("time-legend");
      if (live && live.timeseries && live.timeseries.length) {
        const ts = live.timeseries.slice(-120);
        STAC.line(timeEl, ts.map((d) => d.date), [
          { name: "Views", color: "var(--sec-art)", values: ts.map((d) => d.views), area: true },
          { name: "Downloads", color: "var(--sec-cre)", values: ts.map((d) => d.downloads) }
        ]);
        legend.innerHTML = '<span><i style="background:var(--sec-art)"></i>Views</span><span><i style="background:var(--sec-cre)"></i>Downloads</span>';
      } else if (demo) {
        const d = demoData(state);
        STAC.line(timeEl, d.dates, [
          { name: "Views", color: "var(--sec-art)", values: d.views, area: true },
          { name: "Downloads", color: "var(--sec-cre)", values: d.downloads }
        ], { title: "Demo series" });
        legend.innerHTML = '<span><i style="background:var(--sec-art)"></i>Views (demo)</span><span><i style="background:var(--sec-cre)"></i>Downloads (demo)</span>';
      } else {
        timeEl.innerHTML = `<div class="empty"><p><b>Counting starts with the backend.</b></p><p style="margin-top:6px;font-size:var(--fs-sm)">Deploy the Cloudflare Worker in <span class="mono">worker/</span> and set <span class="mono">backend.api_base</span> in <span class="mono">config/site.yml</span>. Switch on demo data above to see how this panel will look.</p></div>`;
      }

      // Activity log
      const logEl = document.getElementById("log");
      const rows = demo && !live ? demoData(state).log : [];
      const mine = (STAC.store.get("history", []) || []).slice(0, 10);
      if (rows.length) {
        logEl.innerHTML = `<table class="log-table"><thead><tr><th>Time (UTC)</th><th>Event</th><th>Instrument</th><th>File</th><th>Visitor</th></tr></thead><tbody>
          ${rows.map((e) => `<tr><td class="mono">${esc(e.ts)}</td><td><span class="ev">${esc(e.type)}</span></td><td>${esc(e.instrument.display)}</td><td class="mono">${esc(e.file)}</td><td class="mono">${esc(e.visitor)}</td></tr>`).join("")}</tbody></table>`;
      } else if (mine.length) {
        logEl.innerHTML = `<p class="sub">Your own recent activity on this device (${esc(STAC.api.localPseudonym() || "")}):</p><table class="log-table"><tbody>${mine.map((e) => `<tr><td class="mono">${esc(e.ts.slice(0, 16).replace("T", " "))}</td><td><span class="ev">${esc(e.type)}</span></td><td>${esc((state.byId.get(e.instrument_id) || {}).display || e.instrument_id)}</td><td class="mono">${esc(e.file_path || "")}</td></tr>`).join("")}</tbody></table>`;
      } else {
        logEl.innerHTML = `<p class="sub">The full log is available to moderators through the backend (<span class="mono">GET /v1/admin/log</span>, JSON or CSV). Turn on demo data to preview it.</p>`;
      }

      document.getElementById("demo-toggle").addEventListener("change", (e) => {
        demo = e.target.checked;
        STAC.store.set("demo", demo);
        STAC.dashboard.render(root, state);
      });
    }
  };
})();
