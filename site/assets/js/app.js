/* STAC catalogue application: data loading, search, facets, specimen grid,
 * instrument dossier, selection tray, routing. */
(function () {
  "use strict";
  const STAC = window.STAC;
  const { esc, icon, $, $$, fmt, fmtCompact, store } = STAC;

  const state = {
    catalog: null,
    stats: null,
    items: [],
    byId: new Map(),
    q: "",
    filters: { section: new Set(), kind: new Set(), lang: new Set(), platform: new Set(), family: new Set(), tier: new Set(), origin: new Set(), tags: new Set(), quality: new Set() },
    ready: false,
    sort: "relevance",
    mode: store.get("mode", "grid"),
    picks: new Set(store.get("picks", [])),
    interest: new Set(store.get("interest", [])),
    search: null,
    scores: null,
    open: null,
    tab: "files",
    fileIdx: 0
  };
  STAC.state = state;

  const SEC_COLOR = {
    "art-and-aesthetics": "var(--sec-art)",
    creativity: "var(--sec-cre)",
    "personality-and-individual-differences": "var(--sec-pid)"
  };
  STAC.SEC_COLOR = SEC_COLOR;

  /* ============================================================== data == */
  async function load() {
    const [catalog, stats] = await Promise.all([
      fetch("data/catalog.json").then((r) => r.json()),
      fetch("data/stats.json").then((r) => (r.ok ? r.json() : null)).catch(() => null)
    ]);
    state.catalog = catalog;
    state.stats = stats;
    STAC.api.init(catalog);

    // Accession codes: section code + running number within the section
    const counters = {};
    catalog.instruments.forEach((it) => {
      const code = STAC.SECTION_CODE[it.section] || "XX";
      counters[code] = (counters[code] || 0) + 1;
      it.accession = `${code}-${String(counters[code]).padStart(3, "0")}`;
      it.langNames = (it.languages || []).map((l) => catalog.facets.languages[l] || l);
      it.platformNames = (it.platforms || []).map((p) => catalog.facets.platforms[p] || p);
      it.legacy = (stats && stats.legacy && stats.legacy.by_instrument && stats.legacy.by_instrument[it.id]) || it.legacy_downloads_min || null;
      it.live = (stats && stats.live && stats.live.by_instrument && stats.live.by_instrument[it.id]) || null;
      state.byId.set(it.id, it);
    });
    state.items = catalog.instruments;
    buildSearch();
  }

  function buildSearch() {
    const docs = state.items.map((it) => ({
      id: it.id,
      acronym: it.acronym || "",
      title: it.title,
      summary: it.summary || "",
      tags: (it.tags || []).join(" ").replace(/-/g, " "),
      langs: it.langNames.join(" "),
      platforms: it.platformNames.join(" "),
      files: it.files.map((f) => f.name.replace(/[_.]/g, " ")).join(" "),
      refs: [...(it.references.primary || []), ...(it.references.further || [])].join(" "),
      section: `${it.section_label} ${it.subsection_label || ""} ${it.kind_label}`
    }));
    if (window.MiniSearch) {
      state.search = new window.MiniSearch({
        fields: ["acronym", "title", "summary", "tags", "langs", "platforms", "files", "refs", "section"],
        storeFields: ["id"],
        searchOptions: { boost: { acronym: 5, title: 3, tags: 2, langs: 2, platforms: 2 }, prefix: true, fuzzy: 0.2, combineWith: "AND" }
      });
      state.search.addAll(docs);
    } else {
      // Fallback: plain substring search
      state.search = {
        search(q) {
          const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
          return docs
            .map((d) => {
              const hay = Object.values(d).join(" ").toLowerCase();
              return terms.every((t) => hay.includes(t)) ? { id: d.id, score: 1 } : null;
            })
            .filter(Boolean);
        }
      };
    }
  }

  /* =========================================================== filters == */
  const FACETS = [
    { key: "section", title: "Section", get: (it) => [it.section], label: (v) => state.catalog.facets.sections[v].label, dot: true },
    { key: "kind", title: "Type", get: (it) => [it.kind], label: (v) => state.catalog.facets.kinds[v] },
    { key: "lang", title: "Language", get: (it) => it.languages, label: (v) => state.catalog.facets.languages[v] || v },
    { key: "platform", title: "Survey / task platform", get: (it) => it.platforms, label: (v) => state.catalog.facets.platforms[v] || v },
    { key: "family", title: "File type", get: (it) => it.families, label: (v) => state.catalog.facets.families[v] || v },
    { key: "tier", title: "Access", get: (it) => [it.access.tier], label: (v) => state.catalog.facets.tiers[v].label },
    { key: "origin", title: "Origin", get: (it) => [it.origin], label: (v) => ({ osf: "OSF archive (frozen Oct 2026)", github: "Added on GitHub" }[v] || v) },
    { key: "quality", title: "Metadata quality", get: (it) => [it.quality.level], label: (v) => ({ gold: "Gold (85+)", silver: "Silver (65–84)", bronze: "Bronze (45–64)", draft: "Draft (<45)" }[v]) }
  ];

  function matches(it, exceptKey) {
    if (state.scores && !state.scores.has(it.id)) return false;
    if (state.ready && exceptKey !== "ready" && !it.survey_ready) return false;
    for (const f of FACETS) {
      if (f.key === exceptKey) continue;
      const sel = state.filters[f.key];
      if (sel.size && !f.get(it).some((v) => sel.has(v))) return false;
    }
    if (exceptKey !== "tags" && state.filters.tags.size && ![...state.filters.tags].every((t) => (it.tags || []).includes(t))) return false;
    return true;
  }

  function results() {
    let list = state.items.filter((it) => matches(it));
    const s = state.sort;
    const by = {
      az: (a, b) => a.display.localeCompare(b.display),
      popular: (a, b) => (b.legacy || 0) - (a.legacy || 0) || a.display.localeCompare(b.display),
      languages: (a, b) => b.languages.length - a.languages.length || a.display.localeCompare(b.display),
      quality: (a, b) => b.quality.score - a.quality.score,
      newest: (a, b) => String(b.last_change || "").localeCompare(String(a.last_change || "")) || a.display.localeCompare(b.display),
      relevance: (a, b) => (state.scores ? (state.scores.get(b.id) || 0) - (state.scores.get(a.id) || 0) : a.display.localeCompare(b.display))
    };
    return list.sort(by[s] || by.relevance);
  }

  function runSearch() {
    const q = state.q.trim();
    if (!q) { state.scores = null; return; }
    const hits = state.search.search(q);
    state.scores = new Map(hits.map((h) => [h.id, h.score]));
  }

  /* ============================================================ render == */
  function renderLedger() {
    const t = state.catalog.totals;
    const legacy = state.stats && state.stats.legacy;
    const cells = [
      [fmt(t.instruments), "scales, tasks and methods"],
      [fmt(t.files), `files · ${STAC.fmtBytes(t.bytes)}`],
      [fmt(t.languages), "languages"],
      [fmt(t.survey_ready), "with survey or task files"],
      [fmt(t.platforms), "survey / task platforms"],
      [legacy ? `${fmtCompact(legacy.total)}${legacy.kind === "lower-bound" ? "+" : ""}` : "–", "downloads on OSF"]
    ];
    $("#ledger").innerHTML = cells.map(([b, s]) => `<div><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join("");
  }

  function renderSuggest() {
    const ex = ["divergent thinking", "German", "Qualtrics", "humor", "musical", "curiosity", "MediaLab", "achievement"];
    $("#suggest").innerHTML = `<span>Try</span>${ex.map((e) => `<button type="button" data-q="${esc(e)}">${esc(e)}</button>`).join("")}`;
  }

  function renderFacets() {
    let html = `<div class="facet"><h3>Ready to run</h3>
      <label class="opt"><input type="checkbox" id="f-ready" ${state.ready ? "checked" : ""}> Survey or task file included <span class="count">${state.items.filter((it) => matches(it, "ready") && it.survey_ready).length}</span></label></div>`;
    FACETS.forEach((f) => {
      const counts = new Map();
      state.items.filter((it) => matches(it, f.key)).forEach((it) => f.get(it).forEach((v) => counts.set(v, (counts.get(v) || 0) + 1)));
      const all = new Map();
      state.items.forEach((it) => f.get(it).forEach((v) => all.set(v, (all.get(v) || 0) + 1)));
      const values = [...all.keys()].sort((a, b) => (all.get(b) - all.get(a)) || String(a).localeCompare(String(b)));
      const sel = state.filters[f.key];
      html += `<div class="facet"><h3>${esc(f.title)}${sel.size ? `<button type="button" data-clear="${f.key}">Clear</button>` : ""}</h3>
        ${values.map((v) => {
          const c = counts.get(v) || 0;
          const id = `f-${f.key}-${String(v).replace(/[^a-z0-9]/gi, "")}`;
          return `<label class="opt ${c ? "" : "zero"}" for="${id}"><input type="checkbox" id="${id}" data-facet="${f.key}" value="${esc(v)}" ${sel.has(v) ? "checked" : ""}>
            ${f.dot ? `<span class="dot" data-sec="${esc(v)}"></span>` : ""}${esc(f.label(v))}<span class="count">${c}</span></label>`;
        }).join("")}</div>`;
    });
    const tagCounts = new Map();
    state.items.filter((it) => matches(it, "tags")).forEach((it) => (it.tags || []).forEach((t) => tagCounts.set(t, (tagCounts.get(t) || 0) + 1)));
    const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
    html += `<div class="facet"><h3>Constructs${state.filters.tags.size ? `<button type="button" data-clear="tags">Clear</button>` : ""}</h3>
      <div class="tag-cloud">${tags.map(([t, c]) => `<button type="button" data-tag="${esc(t)}" aria-pressed="${state.filters.tags.has(t)}">${esc(t.replace(/-/g, " "))} <span class="mono">${c}</span></button>`).join("")}</div>
      <p class="eyebrow" style="margin-top:8px;text-transform:none;letter-spacing:0">Tags are suggested automatically and await curation.</p></div>`;
    $("#facets").innerHTML = html;
  }

  function cardHtml(it) {
    const acrLong = it.display.length > 9;
    const metric = it.legacy
      ? `<span class="metric" title="Downloads on OSF (lower bound reported in the STAC paper)">${icon("download")}${fmtCompact(it.legacy)}+</span>`
      : it.live && it.live.downloads
        ? `<span class="metric">${icon("download")}${fmtCompact(it.live.downloads)}</span>` : "";
    const ready = it.survey_ready ? `<span class="badge b-ready" title="${esc(it.platformNames.join(", ") || "Task software")}">${icon("bolt")}${esc(it.platformNames.slice(0, 2).join(" · ") || "Task files")}</span>` : "";
    return `<article class="tag" data-open="${esc(it.id)}" tabindex="0" role="button" aria-label="${esc(it.display)}: ${esc(it.title)}">
      <div class="tag-head"><span class="dot" data-sec="${esc(it.section)}"></span><span class="acc">${esc(it.accession)}</span><span>${esc(it.kind_label)}</span></div>
      <div class="tag-acr ${acrLong ? "long" : ""}">${esc(it.display)}</div>
      <div class="tag-title">${esc(it.acronym ? it.title : it.subsection_label || it.section_label)}</div>
      <div class="tag-badges">${it.origin === "github" ? `<span class="badge b-open" title="Added on GitHub ${esc(it.added || "")}">${icon("plus")}New</span>` : ""}${STAC.accessBadge(it.access)}${ready}</div>
      <div class="tag-foot">
        <span class="langs" title="${esc(it.langNames.join(", "))}">${esc((it.languages || []).map((l) => l.toUpperCase()).join(" ") || "lang ?")}</span>
        <span>${it.n_files} file${it.n_files === 1 ? "" : "s"}</span>
        ${metric}
      </div>
      <button class="pick" type="button" data-pick="${esc(it.id)}" aria-pressed="${state.picks.has(it.id)}" aria-label="Add ${esc(it.display)} to selection">${icon(state.picks.has(it.id) ? "check" : "plus")}</button>
    </article>`;
  }

  function renderGrid() {
    const list = results();
    const n = list.length;
    $("#result-count").innerHTML = `<span class="num">${n}</span> of ${state.items.length} instruments`;
    const chips = [];
    if (state.q) chips.push(["q", "", `“${state.q}”`]);
    if (state.ready) chips.push(["ready", "", "Ready to run"]);
    FACETS.forEach((f) => state.filters[f.key].forEach((v) => chips.push([f.key, v, f.label(v)])));
    state.filters.tags.forEach((t) => chips.push(["tags", t, t.replace(/-/g, " ")]));
    $("#active-filters").innerHTML = chips.map(([k, v, l]) => `<button class="chip-x" type="button" data-unset="${esc(k)}" data-value="${esc(v)}">${esc(l)} ${icon("x")}</button>`).join("");
    const grid = $("#grid");
    grid.classList.toggle("list-mode", state.mode === "list");
    grid.innerHTML = n
      ? list.map(cardHtml).join("")
      : `<div class="empty"><p><b>No instrument matches these filters.</b></p><p style="margin-top:6px">Remove a filter, or tell the moderators what is missing.</p>
         <p style="margin-top:12px"><a class="btn" href="#/board" data-board-tab="missing">${icon("plus")} Request a measure</a></p></div>`;
    $("#view-grid").setAttribute("aria-pressed", state.mode === "grid");
    $("#view-list").setAttribute("aria-pressed", state.mode === "list");
  }

  function refresh() {
    runSearch();
    renderFacets();
    renderGrid();
    renderTray();
  }

  /* ========================================================= selection == */
  function savePicks() { store.set("picks", [...state.picks]); }

  function renderTray() {
    const n = state.picks.size;
    $("#tray-root").innerHTML = n
      ? `<div class="tray" role="region" aria-label="Selection">
          <span><b>${n}</b> selected</span>
          <button class="btn btn-sm" type="button" data-tray="cite">${icon("quote")} Copy references</button>
          <button class="btn btn-sm" type="button" data-tray="csv">${icon("copy")} Copy as CSV</button>
          <button class="btn btn-sm" type="button" data-tray="clear">${icon("x")} Clear</button>
        </div>`
      : "";
  }

  function trayAction(kind) {
    const picks = [...state.picks].map((id) => state.byId.get(id)).filter(Boolean);
    if (kind === "clear") { state.picks.clear(); savePicks(); refresh(); return; }
    if (kind === "cite") {
      const refs = picks.flatMap((it) => (it.references.primary.length ? it.references.primary : [`${it.display}: no reference recorded yet`]));
      STAC.copy([...new Set(refs)].join("\n\n"), `${picks.length} reference lists copied`);
    }
    if (kind === "csv") {
      const rows = [["accession", "acronym", "title", "section", "kind", "languages", "platforms", "access", "files", "url"]];
      picks.forEach((it) => rows.push([it.accession, it.acronym || "", it.title, it.section_label, it.kind_label, it.languages.join(" "), it.platformNames.join(" "), it.access.short, it.n_files, `${STAC.api.repoUrl}/tree/main/${it.repo_path}`]));
      STAC.copy(rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n"), "Selection copied as CSV");
    }
  }

  /* =========================================================== dossier == */
  function openDossier(id, tab) {
    const it = state.byId.get(id);
    if (!it) return;
    state.open = it;
    state.tab = tab || "files";
    const firstPreview = it.files.findIndex((f) => f.role === "instrument" && f.preview.type !== "none");
    state.fileIdx = firstPreview >= 0 ? firstPreview : 0;
    STAC.api.track("view", it.id);
    renderDossier();
    document.body.style.overflow = "hidden";
  }

  function closeDossier() {
    state.open = null;
    $("#dossier-root").innerHTML = "";
    document.body.style.overflow = "";
    if (/^#\/?instrument/.test(location.hash)) history.replaceState(null, "", "#/");
  }

  function renderDossier() {
    const it = state.open;
    const flagsN = it.quality.flags.length + it.quality.file_flags.length;
    const tabs = [
      ["files", "Files & preview", it.n_files],
      ["about", "About", null],
      ["cite", "Cite", it.references.primary.length + it.references.further.length],
      ["history", "History", null],
      ["quality", "Quality", flagsN],
      ["discuss", "Discuss", null]
    ];
    const bundle = STAC.api.releaseBundleUrl(it.id);
    $("#dossier-root").innerHTML = `<div class="scrim" data-close></div>
      <div class="dossier" role="dialog" aria-modal="true" aria-labelledby="d-acr">
        <div class="dossier-head">
          <div class="dossier-top">
            <div style="min-width:0">
              <p class="eyebrow"><span class="dot" data-sec="${esc(it.section)}" style="display:inline-block;margin-right:6px"></span>${esc(it.accession)} · ${esc(it.section_label)}${it.subsection_label ? " · " + esc(it.subsection_label) : ""}</p>
              <h2 class="d-acr" id="d-acr">${esc(it.display)}</h2>
              ${it.acronym ? `<p class="d-title">${esc(it.title)}</p>` : ""}
            </div>
            <button class="btn btn-ghost close" type="button" data-close aria-label="Close">${icon("x")}</button>
          </div>
          <div class="d-meta">
            ${STAC.accessBadge(it.access)}
            ${it.access.verified ? "" : `<span class="badge b-warn" title="${esc(STAC.flagLabel("access_unverified"))}">${icon("alert")}License unverified</span>`}
            ${STAC.qualityBadge(it.quality)}
            ${it.survey_ready ? `<span class="badge b-ready">${icon("bolt")}${esc(it.platformNames.join(" · ") || "Task files")}</span>` : ""}
            <span class="badge b-silver">${icon("globe")}${esc(it.langNames.join(", ") || "Language not stated")}</span>
            ${it.legacy ? `<span class="badge b-silver" title="${esc(state.stats.legacy.source)}">${icon("download")}${fmt(it.legacy)}+ OSF downloads</span>` : ""}
          </div>
          <div class="d-actions">
            <a class="btn btn-primary" href="${esc(bundle)}" target="_blank" rel="noopener" data-track="download">${icon("download")} Download all</a>
            <button class="btn" type="button" data-act="cite">${icon("quote")} Copy citation</button>
            <a class="btn" href="${esc(STAC.api.forkUrl())}" target="_blank" rel="noopener" data-track="fork_click">${icon("fork")} Fork to adapt</a>
            <button class="btn" type="button" data-act="interest" aria-pressed="${state.interest.has(it.id)}">${icon("star")} ${state.interest.has(it.id) ? "Following" : "Follow"}</button>
            <a class="btn" href="${esc(STAC.api.issueUrl("03-error-report.yml", `[Error]: ${it.display}`, { instrument: it.id }))}" target="_blank" rel="noopener">${icon("flag")} Report an error</a>
            <button class="btn" type="button" data-act="share">${icon("share")} Copy link</button>
          </div>
          <div class="tabs" role="tablist">
            ${tabs.map(([k, l, c]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${state.tab === k}">${esc(l)}${c ? `<span class="count">${c}</span>` : ""}</button>`).join("")}
          </div>
        </div>
        <div class="dossier-body" id="dossier-body"></div>
      </div>`;
    renderTab();
    const closeBtn = $(".dossier .close");
    if (closeBtn) closeBtn.focus({ preventScroll: true });
  }

  function renderTab() {
    const it = state.open;
    const body = $("#dossier-body");
    $$(".tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === state.tab));
    const T = {
      files: tabFiles,
      about: tabAbout,
      cite: tabCite,
      history: tabHistory,
      quality: tabQuality,
      discuss: tabDiscuss
    };
    body.innerHTML = T[state.tab](it);
    if (state.tab === "files") showFile(state.fileIdx);
    if (state.tab === "discuss") STAC.board.mountInstrumentThread($("#thread"), it);
  }

  function tabFiles(it) {
    const rows = it.files.map((f, i) => {
      const langs = (f.languages || []).map((l) => state.catalog.facets.languages[l] || l).join(", ");
      const warn = (f.flags || []).filter((x) => STAC.FLAGS[x] && STAC.FLAGS[x].sev !== "info");
      return `<div class="file-row" data-file="${i}" role="button" tabindex="0" aria-current="${i === state.fileIdx}">
        <span class="ext" data-fam="${esc(f.family)}">${esc(f.ext)}</span>
        <div style="min-width:0">
          <div class="file-name">${esc(f.name)}</div>
          <div class="file-sub"><span>${esc(STAC.ROLE_LABEL[f.role] || f.role)}</span>${langs ? `<span>${esc(langs)}</span>` : ""}<span>${esc(f.format_label)}${f.platform_label ? " · " + esc(f.platform_label) : ""}</span><span class="mono">${esc(f.size_h)}</span></div>
          ${warn.length ? `<div class="flag-list">${warn.map((x) => `<span class="badge b-warn" title="${esc(STAC.flagLabel(x))}">${icon("alert")}${esc(x.replace(/_/g, " "))}</span>`).join("")}</div>` : ""}
        </div>
        <div class="file-actions">
          <a class="icon-btn" href="${esc(f.href)}" ${f.on_site ? `download="${esc(f.name)}"` : `target="_blank" rel="noopener"`} data-dl="${i}" aria-label="Download ${esc(f.name)}" title="Download (${esc(f.size_h)})">${icon("download")}</a>
          <a class="icon-btn" href="${esc(f.github_url)}" target="_blank" rel="noopener" aria-label="Open ${esc(f.name)} on GitHub" title="View on GitHub">${icon("external")}</a>
        </div>
      </div>`;
    }).join("");
    return `<div class="files-layout">
      <div class="file-list">${rows}
        <p class="eyebrow" style="text-transform:none;letter-spacing:0;margin-top:6px">SHA-256 checksums and the original OSF path of every file are listed in migration/osf_path_map.csv.</p>
      </div>
      <div class="viewer" id="viewer"><div class="viewer-head"><span class="name"></span></div><div class="viewer-body"></div></div>
    </div>`;
  }

  function showFile(i) {
    const it = state.open;
    const f = it.files[i];
    if (!f) return;
    state.fileIdx = i;
    $$(".file-row").forEach((r) => r.setAttribute("aria-current", +r.dataset.file === i));
    const v = $("#viewer");
    v.querySelector(".viewer-head").innerHTML = `<span class="ext" data-fam="${esc(f.family)}" style="width:30px;height:34px">${esc(f.ext)}</span>
      <span class="name">${esc(f.name)}<br><span class="mono" style="font-weight:400;color:var(--ink-3);font-size:var(--fs-xs)">${esc(f.format_label)} · ${esc(f.size_h)} · sha256 ${esc(f.sha256.slice(0, 10))}…</span></span>
      <a class="btn btn-sm" href="${esc(f.href)}" ${f.on_site ? `download="${esc(f.name)}"` : `target="_blank" rel="noopener"`} data-dl="${i}">${icon("download")} Download</a>`;
    STAC.preview.render(v, f, it);
  }

  function tabAbout(it) {
    const sum = it.summary ? `<p>${esc(it.summary)}</p>` : `<p class="na">No overview in the README yet.</p>`;
    const admin = it.administration_html ? it.administration_html : `<p class="na">Administration and scoring are not documented (README says NA).</p>`;
    return `<div class="panel">
      <div class="cols-2">
        <div class="card"><h3>Overview</h3><div class="prose">${sum}</div></div>
        <div class="card"><h3>Facts</h3><dl class="kv">
          <dt>Type</dt><dd>${esc(it.kind_label)}</dd>
          <dt>Languages</dt><dd>${esc(it.langNames.join(", ") || "not stated")}</dd>
          <dt>Platforms</dt><dd>${esc(it.platformNames.join(", ") || "none")}</dd>
          <dt>Files</dt><dd>${it.n_files} · ${esc(STAC.fmtBytes(it.bytes))}</dd>
          <dt>Access</dt><dd>${esc(it.access.statement)}</dd>
          <dt>Version</dt><dd class="mono">${esc(it.version)} · ${esc(it.stage || "")}</dd>
          <dt>Repository</dt><dd><a href="${esc(STAC.api.repoUrl + "/tree/main/" + it.repo_path)}" target="_blank" rel="noopener" class="mono">${esc(it.repo_path)}</a></dd>
          <dt>Legacy OSF path</dt><dd class="mono">${esc((it.provenance && it.provenance.osf_path) || "–")}</dd>
        </dl></div>
      </div>
      <div class="card"><h3>Administration and scoring</h3><div class="prose">${admin}</div></div>
      <details class="card"><summary><b>Original README</b> (as migrated from OSF)</summary><div class="prose" style="margin-top:10px">${it.readme_html ? it.readme_html.replace(/<script[\s\S]*?<\/script>/gi, "") : '<p class="na">No README in this folder.</p>'}</div></details>
    </div>`;
  }

  function tabCite(it) {
    const perFile = it.files.filter((f) => f.role === "instrument" || f.role === "software");
    const blocks = perFile.map((f, i) => `<div class="cite-box"><div class="for">${esc(f.name)}</div>
        <span id="cite-f-${i}">${f.citation ? esc(f.citation) : '<span class="na">No reference recorded for this version.</span>'}</span>
        ${f.citation ? `<button class="icon-btn" type="button" data-copy-from="cite-f-${i}" aria-label="Copy">${icon("copy")}</button>` : ""}</div>`).join("");
    const further = it.references.further.map((r) => `<li>${esc(r)}</li>`).join("");
    const dois = it.dois.map((d) => `<a class="badge b-silver" href="https://doi.org/${esc(d)}" target="_blank" rel="noopener">doi:${esc(d)}</a>`).join(" ");
    const stacCite = `${state.catalog.legacy.paper_citation}`;
    return `<div class="panel">
      <div class="notice">${icon("quote")}<div>Cite the original source of the version you use. When helpful, cite STAC as the access point as well.</div></div>
      <div><h3 style="margin-bottom:10px">Per file</h3><div class="panel" style="gap:8px">${blocks || '<p class="na">No instrument files.</p>'}</div></div>
      ${further ? `<div class="card"><h3>Further psychometric references</h3><ul class="prose" style="padding-left:18px">${further}</ul></div>` : ""}
      ${dois ? `<div><h3 style="margin-bottom:8px">Resolvable DOIs</h3><div style="display:flex;flex-wrap:wrap;gap:6px">${dois}</div></div>` : ""}
      <div><h3 style="margin-bottom:8px">STAC access point</h3><div class="cite-box"><span id="cite-stac-d">${esc(stacCite)}</span><button class="icon-btn" type="button" data-copy-from="cite-stac-d" aria-label="Copy">${icon("copy")}</button></div></div>
    </div>`;
  }

  function tabHistory(it) {
    const h = (it.history || []).map((c) => `<li><div class="when">${esc(c.date)} · ${esc(c.author)} · <span class="mono">${esc(c.hash)}</span></div>${esc(c.message)}</li>`).join("");
    const mine = (store.get("history", []) || []).filter((e) => e.instrument_id === it.id).slice(0, 10)
      .map((e) => `<li><div class="when">${esc(e.ts.slice(0, 16).replace("T", " "))}</div>${esc(e.type)}${e.file_path ? " · " + esc(e.file_path) : ""}</li>`).join("");
    return `<div class="cols-2">
      <div class="card"><h3>Change log</h3>
        <ul class="timeline">
          ${h}
          <li><div class="when">${esc((it.provenance && it.provenance.migrated) || "")}</div>Migrated 1:1 from OSF storage. Folder renamed from <span class="mono">${esc((it.provenance && it.provenance.osf_path) || "")}</span>; file contents unchanged (verified by SHA-256).</li>
          <li><div class="when">2024</div>Moved into its own folder with README during the STAC restructuring on OSF.</li>
        </ul>
        <p class="eyebrow" style="margin-top:12px;text-transform:none;letter-spacing:0">Every later change is a Git commit; commit authors appear under pseudonyms.</p>
      </div>
      <div class="card"><h3>Your activity</h3>
        ${STAC.api.optinId() ? (mine ? `<ul class="timeline">${mine}</ul>` : "<p>No downloads or previews recorded yet.</p>") : `<p style="font-size:var(--fs-sm);color:var(--ink-2)">Opt in on the About page to keep a private history of your downloads under a pseudonym on this device.</p>`}
      </div>
    </div>`;
  }

  function tabQuality(it) {
    const q = it.quality;
    const comp = q.components;
    const maxes = { readme: 20, no_na: 20, no_drift: 15, languages: 10, doi: 15, access: 10, clean: 10 };
    const names = { readme: "README present", no_na: "No NA fields", no_drift: "README matches files", languages: "Languages stated", doi: "DOI present", access: "License verified", clean: "Clean files" };
    const bars = Object.keys(maxes).map((k) => `<div class="bar-row"><span>${names[k]}</span><div class="bar-track"><div class="bar-fill" style="width:${(100 * (comp[k] || 0)) / maxes[k]}%"></div></div><span class="mono">${comp[k] || 0}/${maxes[k]}</span></div>`).join("");
    const fileFlags = it.files.flatMap((f) => (f.flags || []).map((x) => [x, f.name]));
    const items = [...q.flags.map((x) => [x, null]), ...fileFlags]
      .filter(([x]) => !STAC.FLAGS[x] || STAC.FLAGS[x].sev !== "info")
      .map(([x, file]) => `<div class="flag-item ${STAC.FLAGS[x] && STAC.FLAGS[x].sev === "crit" ? "crit" : ""}">${icon("alert")}<div><b>${esc(STAC.flagLabel(x))}</b>${file ? `<div class="mono" style="font-size:var(--fs-xs);color:var(--ink-3)">${esc(file)}</div>` : ""}</div></div>`).join("");
    const fix = STAC.api.issueUrl("05-metadata-correction.yml", `[Metadata]: ${it.display}`, { instrument: it.id });
    return `<div class="panel">
      <div class="card"><div class="score"><div class="score-ring" style="--v:${q.score}"><b>${q.score}</b></div><div class="bars">${bars}</div></div></div>
      <div class="card"><h3>Open issues found during migration</h3>${items || "<p>None.</p>"}
        <p style="margin-top:12px"><a class="btn" href="${esc(fix)}" target="_blank" rel="noopener">${icon("flag")} Suggest a correction</a></p></div>
      ${q.na_fields ? `<p class="eyebrow" style="text-transform:none;letter-spacing:0">README contains ${q.na_fields} NA placeholder line(s).</p>` : ""}
    </div>`;
  }

  function tabDiscuss(it) {
    return `<div id="thread"></div>`;
  }

  /* ============================================================ router == */
  function route() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [path, query] = raw.split("?");
    const parts = path.split("/").filter(Boolean);
    let view = parts[0] || "catalog";
    let openId = null;
    if (view === "instrument" || view === "i") { openId = parts[1]; view = "catalog"; }
    else if (view.startsWith("instrument-")) { openId = view.slice(11); view = "catalog"; }
    if (!["catalog", "dashboard", "board", "contribute", "about"].includes(view)) view = "catalog";
    $$("[data-view]").forEach((s) => { s.hidden = s.dataset.view !== view; });
    $$("[data-nav]").forEach((a) => (a.dataset.nav === view ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
    if (view === "dashboard") STAC.dashboard.render($("#dashboard"), state);
    if (view === "board") {
      const tab = new URLSearchParams(query || "").get("tab");
      STAC.board.render($("#board"), state, tab || STAC.board.pendingTab || "public");
      STAC.board.pendingTab = null;
    }
    if (openId && state.byId.has(openId)) openDossier(openId);
    else if (state.open && !openId) closeDossier();
    if (!openId) window.scrollTo({ top: 0 });
  }

  /* ============================================================ events == */
  function bind() {
    const q = $("#q");
    q.addEventListener("input", STAC.debounce(() => { state.q = q.value; state.sort = state.q ? "relevance" : state.sort; refresh(); }, 120));

    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); location.hash = "#/"; q.focus(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); location.hash = "#/"; q.focus(); }
      if (e.key === "Escape" && state.open) closeDossier();
      if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-open],.file-row")) { e.preventDefault(); e.target.click(); }
    });

    $("#suggest").addEventListener("click", (e) => {
      const b = e.target.closest("[data-q]");
      if (!b) return;
      q.value = b.dataset.q;
      state.q = q.value;
      refresh();
    });

    $("#facets").addEventListener("change", (e) => {
      const t = e.target;
      if (t.id === "f-ready") state.ready = t.checked;
      else if (t.dataset.facet) {
        const s = state.filters[t.dataset.facet];
        t.checked ? s.add(t.value) : s.delete(t.value);
      }
      refresh();
    });
    $("#facets").addEventListener("click", (e) => {
      const c = e.target.closest("[data-clear]");
      if (c) { state.filters[c.dataset.clear].clear(); refresh(); return; }
      const tg = e.target.closest("[data-tag]");
      if (tg) { const s = state.filters.tags; s.has(tg.dataset.tag) ? s.delete(tg.dataset.tag) : s.add(tg.dataset.tag); refresh(); }
    });
    $("#facet-toggle").addEventListener("click", (e) => {
      const f = $("#facets");
      f.classList.toggle("open");
      e.currentTarget.setAttribute("aria-expanded", f.classList.contains("open"));
    });

    $("#active-filters").addEventListener("click", (e) => {
      const c = e.target.closest("[data-unset]");
      if (!c) return;
      const k = c.dataset.unset;
      if (k === "q") { state.q = ""; q.value = ""; }
      else if (k === "ready") state.ready = false;
      else state.filters[k].delete(c.dataset.value);
      refresh();
    });

    $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; renderGrid(); });
    $("#view-grid").addEventListener("click", () => { state.mode = "grid"; store.set("mode", "grid"); renderGrid(); });
    $("#view-list").addEventListener("click", () => { state.mode = "list"; store.set("mode", "list"); renderGrid(); });

    $("#grid").addEventListener("click", (e) => {
      const p = e.target.closest("[data-pick]");
      if (p) {
        e.stopPropagation();
        const id = p.dataset.pick;
        state.picks.has(id) ? state.picks.delete(id) : state.picks.add(id);
        savePicks();
        renderGrid();
        renderTray();
        return;
      }
      const card = e.target.closest("[data-open]");
      if (card) location.hash = `#/instrument/${card.dataset.open}`;
    });

    $("#tray-root").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tray]");
      if (b) trayAction(b.dataset.tray);
    });

    $("#dossier-root").addEventListener("click", (e) => {
      const it = state.open;
      if (!it) return;
      if (e.target.closest("[data-close]")) { closeDossier(); return; }
      const tab = e.target.closest("[data-tab]");
      if (tab) { state.tab = tab.dataset.tab; renderTab(); return; }
      const dl = e.target.closest("[data-dl]");
      if (dl) { STAC.api.track("download", it.id, it.files[+dl.dataset.dl].name); return; }
      const tr = e.target.closest("[data-track]");
      if (tr) { STAC.api.track(tr.dataset.track, it.id); return; }
      const row = e.target.closest(".file-row");
      if (row) { showFile(+row.dataset.file); return; }
      const cp = e.target.closest("[data-copy-from]");
      if (cp) { STAC.copy($("#" + cp.dataset.copyFrom).textContent.trim(), "Citation copied"); STAC.api.track("cite_copy", it.id); return; }
      const act = e.target.closest("[data-act]");
      if (!act) return;
      if (act.dataset.act === "cite") {
        const refs = it.references.primary.length ? it.references.primary.join("\n\n") : "";
        if (refs) { STAC.copy(refs, "Citation copied"); STAC.api.track("cite_copy", it.id); }
        else STAC.toast("No reference recorded yet. See the Quality tab.");
      }
      if (act.dataset.act === "share") STAC.copy(`${location.origin}${location.pathname}#/instrument/${it.id}`, "Link copied");
      if (act.dataset.act === "interest") {
        const on = !state.interest.has(it.id);
        on ? state.interest.add(it.id) : state.interest.delete(it.id);
        store.set("interest", [...state.interest]);
        if (on) STAC.api.track("interest", it.id);
        act.setAttribute("aria-pressed", on);
        act.innerHTML = `${icon("star")} ${on ? "Following" : "Follow"}`;
        STAC.toast(on ? `Following ${it.display}` : "Unfollowed");
      }
    });

    document.addEventListener("click", (e) => {
      const cp = e.target.closest("#about [data-copy-from]");
      if (cp) STAC.copy($("#" + cp.dataset.copyFrom).textContent.trim(), "Citation copied");
      const bt = e.target.closest("[data-board-tab]");
      if (bt) STAC.board.pendingTab = bt.dataset.boardTab;
    });

    $("#theme-toggle").addEventListener("click", () => {
      const root = document.documentElement;
      const cur = root.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      root.dataset.theme = cur === "dark" ? "light" : "dark";
      store.set("theme", root.dataset.theme);
    });

    const optin = $("#optin");
    optin.checked = Boolean(STAC.api.optinId());
    const showName = () => { $("#optin-name").textContent = STAC.api.optinId() ? `Your local pseudonym: ${STAC.api.localPseudonym()}` : ""; };
    showName();
    optin.addEventListener("change", () => { STAC.api.setOptin(optin.checked); showName(); STAC.toast(optin.checked ? "History on for this device" : "History deleted from this device"); });

    window.addEventListener("hashchange", route);
  }

  function staticBits() {
    $("#cite-stac").textContent = state.catalog.legacy.paper_citation;
    $("#gh-link").href = STAC.api.repoUrl;
    $("#submit-link").href = STAC.api.issueUrl("01-new-instrument.yml", "[New instrument]: ");
    const tiers = state.catalog.facets.tiers;
    $("#badge-legend").innerHTML = Object.entries(tiers).map(([k, t]) => `<div>${STAC.accessBadge({ tier: k, short: t.label, statement: t.description })}<span style="color:var(--ink-2)">${esc(t.description)}${t.public_repo ? "" : " Not stored in the public repository."}</span></div>`).join("");
    const fam = {};
    Object.entries(state.catalog.formats).forEach(([ext, f]) => { (fam[f.family] = fam[f.family] || []).push(ext); });
    $("#format-support").innerHTML = Object.entries(fam).map(([k, exts]) => `<b>${esc(state.catalog.facets.families[k] || k)}</b>: <span class="mono">${esc(exts.join(" "))}</span>`).join("<br>") +
      `<br><span style="color:var(--ink-3)">Platform tokens recognised in file names: ${esc(Object.values({ q: "Qualtrics", m: "MediaLab", l: "LimeSurvey", s: "SoSci Survey", u: "Unipark / Tivian EFS", r: "REDCap", p: "Prolific", g: "Gorilla", j: "jsPsych", lab: "lab.js", py: "PsychoPy", ml: "MATLAB" }).join(", "))}.</span>`;
    $("#build-info").textContent = `catalog built ${state.catalog.generated_at.replace("T", " ").replace("Z", " UTC")}`;
  }

  /* ============================================================== boot == */
  (async function boot() {
    const t = store.get("theme", null);
    if (t) document.documentElement.dataset.theme = t;
    // Browsers block fetch() of local files under file://, so the catalog
    // cannot load when index.html is opened by double-click.
    if (location.protocol === "file:") {
      $("#grid").innerHTML = `<div class="empty"><p><b>Please open the catalog through a local web server.</b></p>
        <p style="margin-top:8px">Browsers do not let a page opened from disk (file://) load its data files. In a terminal, go to the <span class="mono">site</span> folder and run</p>
        <p style="margin-top:8px"><span class="mono">python -m http.server 8000</span> &nbsp;or&nbsp; <span class="mono">Rscript ../scripts/serve.R</span></p>
        <p style="margin-top:8px">then open <span class="mono">http://localhost:8000</span>.</p></div>`;
      return;
    }
    try {
      await load();
    } catch (e) {
      $("#grid").innerHTML = `<div class="empty"><p><b>Catalog data could not be loaded.</b></p>
        <p style="margin-top:8px"><span class="mono">site/data/catalog.json</span> is generated, not stored in Git. Build it from the repository root with <span class="mono">Rscript scripts/run_build.R</span>, then reload.</p></div>`;
      return;
    }
    renderLedger();
    renderSuggest();
    staticBits();
    bind();
    $("#sort").value = state.sort;
    refresh();
    route();
  })();
})();
