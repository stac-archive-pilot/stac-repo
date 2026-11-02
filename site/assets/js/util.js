/* STAC utilities: DOM helpers, formatting, safe storage, clipboard, flags. */
(function () {
  "use strict";

  const STAC = (window.STAC = window.STAC || {});

  /** Escape text for HTML insertion. */
  STAC.esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /** Inline SVG icon from the sprite in index.html. */
  STAC.icon = (name, cls = "icon") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

  STAC.$ = (sel, root = document) => root.querySelector(sel);
  STAC.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  STAC.fmt = (n) => (n == null || Number.isNaN(n) ? "–" : new Intl.NumberFormat("en-US").format(n));
  STAC.fmtCompact = (n) =>
    n == null ? "–" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  STAC.fmtBytes = (b) => {
    if (b == null) return "–";
    const u = ["B", "KB", "MB", "GB"];
    let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return `${b.toFixed(i >= 2 ? 1 : 0)} ${u[i]}`;
  };

  STAC.debounce = (fn, ms = 160) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  /** localStorage that never throws (private windows, blocked storage, previews). */
  STAC.store = {
    get(key, fallback) {
      try { const v = localStorage.getItem("stac:" + key); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("stac:" + key, JSON.stringify(value)); } catch { /* ignore */ }
    },
    del(key) { try { localStorage.removeItem("stac:" + key); } catch { /* ignore */ } }
  };

  /** Toast message at the bottom of the screen. */
  STAC.toast = (msg) => {
    const root = document.getElementById("toast-root");
    root.innerHTML = `<div class="toast">${STAC.esc(msg)}</div>`;
    clearTimeout(STAC._toastT);
    STAC._toastT = setTimeout(() => { root.innerHTML = ""; }, 2600);
  };

  /** Copy text inside a click handler; falls back to selecting the text. */
  STAC.copy = async (text, label = "Copied") => {
    try {
      await navigator.clipboard.writeText(text);
      STAC.toast(label);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      ta.remove();
      STAC.toast(ok ? label : "Select the text and copy it manually");
    }
  };

  /** Short accession code shown on specimen tags, e.g. CR-031. */
  STAC.SECTION_CODE = {
    "art-and-aesthetics": "AA",
    creativity: "CR",
    "personality-and-individual-differences": "PI"
  };

  STAC.ROLE_LABEL = {
    instrument: "Instrument",
    scoring: "Scoring key",
    instructions: "Instructions",
    manual: "Manual",
    reference: "Source article",
    stimuli: "Stimuli",
    software: "Task software",
    data: "Data",
    figure: "Figure",
    template: "Template"
  };

  /** Plain-language explanations of quality flags (shown in the Quality tab). */
  STAC.FLAGS = {
    readme_missing: { sev: "crit", text: "No README. Users get no information on administration, scoring or citation." },
    readme_has_na: { sev: "warn", text: "README contains NA placeholders (citation or administration/scoring missing)." },
    readme_lists_missing_files: { sev: "warn", text: "README lists files that do not exist in the folder." },
    files_not_in_readme: { sev: "warn", text: "Folder contains files the README does not describe." },
    access_unverified: { sev: "warn", text: "License statement taken from the README and not yet confirmed by the rights holder. The OSF project itself had no license set." },
    no_doi: { sev: "warn", text: "No DOI found in the references, so the source cannot be resolved automatically." },
    zip_embedded_git: { sev: "crit", text: "Archive contains a complete .git folder (version history of the authors' working copy)." },
    zip_macos_junk: { sev: "warn", text: "Archive contains macOS metadata (__MACOSX, ._ files) that inflate the download." },
    zip_contains_test_data: { sev: "warn", text: "Archive contains a data/ folder with recorded test runs." },
    zip_nested_archive: { sev: "warn", text: "Archive contains further archives." },
    qsf_owner_id: { sev: "warn", text: "Qualtrics export still carries the original SurveyOwnerID." },
    qsf_brand_id: { sev: "warn", text: "Qualtrics export carries the institution's brand ID; import works, but reveals the source account." },
    qsf_placeholder_question: { sev: "warn", text: "Qualtrics survey contains an unedited default question (\"Click to write the question text\")." },
    reference_article_check_license: { sev: "warn", text: "Published article PDF redistributed in the archive. Check that the publisher license allows it." },
    language_unspecified: { sev: "warn", text: "Instrument file name does not state its language." },
    filename_typo: { sev: "warn", text: "Typo in the file name (e.g. \"Englsih\")." },
    not_in_readme: { sev: "warn", text: "File is not mentioned in the README." },
    large_file: { sev: "warn", text: "File is larger than 50 MB (GitHub warns at 50 MB and rejects files above 100 MB)." },
    hosted_in_repository: { sev: "info", text: "Too large for the website; downloaded from the repository instead." },
    que_unreadable_mdbtools_missing: { sev: "warn", text: "MediaLab file could not be read during the build." }
  };

  STAC.flagLabel = (f) => (STAC.FLAGS[f] ? STAC.FLAGS[f].text : f.replace(/_/g, " "));

  STAC.TIER_ICON = {
    open: "globe",
    "academic-noncommercial": "shield",
    "research-only": "shield",
    "commercial-with-permission": "alert",
    "permission-required": "lock",
    restricted: "lock"
  };

  STAC.accessBadge = (a) =>
    `<span class="badge b-${STAC.esc(a.tier)}" title="${STAC.esc(a.statement || "")}">${STAC.icon(STAC.TIER_ICON[a.tier] || "shield")}${STAC.esc(a.short || a.label)}</span>`;

  STAC.qualityBadge = (q) =>
    `<span class="badge b-${q.level}" title="Metadata completeness ${q.score}/100">${STAC.icon("check")}Metadata ${q.level}</span>`;
})();
