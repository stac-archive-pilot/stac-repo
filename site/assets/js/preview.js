/* STAC file previews.
 * PDFs (original or converted at build time) render with pdf.js onto canvas, so
 * previews work even where the browser's own PDF viewer is unavailable.
 * Survey files (Qualtrics, MediaLab, LimeSurvey) show the item list extracted
 * at build time by scripts/04_build_previews.R. */
(function () {
  "use strict";
  const STAC = (window.STAC = window.STAC || {});
  const { esc, icon } = STAC;

  if (window.pdfjsLib) {
    // Self-hosted worker; STAC_PDF_WORKER lets a build (e.g. a CDN variant) override it.
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      window.STAC_PDF_WORKER || new URL("assets/vendor/pdfjs/pdf.worker.min.js", document.baseURI).href;
  }

  const note = (html) => `<div class="viewer-note">${html}</div>`;
  const PAGE_BATCH = 3;

  async function fetchJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }

  /* ------------------------------------------------------------- PDF --- */
  async function renderPdf(body, url, token) {
    if (!window.pdfjsLib) {
      body.innerHTML = note(`PDF viewer could not load. <a href="${esc(url)}" target="_blank" rel="noopener">Open the PDF</a>`);
      return;
    }
    body.innerHTML = note("Rendering PDF …");
    const doc = await window.pdfjsLib.getDocument({ url, isEvalSupported: false }).promise;
    if (token !== STAC.preview._token) return;
    const wrap = document.createElement("div");
    wrap.className = "pdf-pages";
    body.innerHTML = "";
    body.appendChild(wrap);
    let next = 1;
    const width = Math.max(320, Math.min(body.clientWidth - 24, 900));

    async function renderBatch() {
      const end = Math.min(doc.numPages, next + PAGE_BATCH - 1);
      for (let n = next; n <= end; n++) {
        const page = await doc.getPage(n);
        if (token !== STAC.preview._token) return;
        const base = page.getViewport({ scale: 1 });
        const scale = (width / base.width) * (window.devicePixelRatio || 1);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = vp.width;
        canvas.height = vp.height;
        canvas.style.width = `${width}px`;
        canvas.setAttribute("aria-label", `Page ${n} of ${doc.numPages}`);
        wrap.appendChild(canvas);
        await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      }
      next = end + 1;
      const old = wrap.querySelector(".more");
      if (old) old.remove();
      if (next <= doc.numPages) {
        const b = document.createElement("button");
        b.className = "btn more";
        b.type = "button";
        b.textContent = `Show pages ${next}–${Math.min(doc.numPages, next + PAGE_BATCH - 1)} of ${doc.numPages}`;
        b.onclick = () => { b.disabled = true; renderBatch(); };
        wrap.appendChild(b);
      }
    }
    await renderBatch();
  }

  /* ----------------------------------------------------- survey items --- */
  function renderItems(body, p) {
    const meta = p.meta || {};
    const head = [
      meta.survey_name ? `Survey name: <b>${esc(meta.survey_name)}</b>` : "",
      meta.n_items != null ? `${meta.n_items} elements` : "",
      meta.language ? `Language: ${esc(meta.language)}` : "",
      meta.medialab_version ? `MediaLab ${esc(String(meta.medialab_version).slice(0, 4))}` : "",
      meta.brand ? `Brand ID: <span class="mono">${esc(meta.brand)}</span>` : ""
    ].filter(Boolean).join(" · ");
    const items = (p.items || []).map((it) => {
      const isMatrix = /^Matrix/.test(it.type || "");
      const labels = it.labels || [];
      const scale = it.scale || [];
      const rows = isMatrix && labels.length
        ? `<ol class="rows">${labels.map((l) => `<li>${esc(l)}</li>`).join("")}</ol>` : "";
      const chips = (isMatrix ? scale : labels).length
        ? `<div class="labels">${(isMatrix ? scale : labels).map((l) => `<span>${esc(l)}</span>`).join("")}</div>` : "";
      return `<li><div class="meta">${esc(it.tag || it.qid || "")}<br>${esc(it.type || "")}</div>
        <div>${esc(it.text || "")}${rows}${chips}</div></li>`;
    }).join("");
    body.innerHTML = `<div class="viewer-note" style="padding:12px 14px"><div>${head || "Survey structure"}</div><span style="color:var(--ink-3)">Extracted from the file at build time. Formatting, logic and embedded media are not shown.</span></div>
      <ol class="items">${items || "<li><div></div><div>No items found.</div></li>"}</ol>`;
  }

  function renderZip(body, p) {
    const m = p.meta || {};
    const junkPct = m.junk_bytes && (m.junk_bytes + m.content_bytes) ? Math.round((100 * m.junk_bytes) / (m.junk_bytes + m.content_bytes)) : 0;
    const shown = (p.entries || []).filter((e) => !e.is_dir);
    const visible = shown.filter((e) => !e.junk).slice(0, 300);
    const junkCount = shown.filter((e) => e.junk).length;
    body.innerHTML = `<div class="viewer-note" style="padding:12px 14px">
        <span><b>${STAC.fmt(m.n_entries)}</b> entries · content ${STAC.fmtBytes(m.content_bytes)} uncompressed${m.junk_bytes ? ` · <b style="color:var(--crit)">${STAC.fmtBytes(m.junk_bytes)} junk (${junkPct}%)</b> in ${STAC.fmt(junkCount)} hidden entries` : ""}</span>
      </div>
      <div class="tree">${visible.map((e) => `<div class="${e.testdata ? "junk" : ""}"><span>${esc(e.path)}</span><span class="sz">${STAC.fmtBytes(e.size)}</span></div>`).join("")}
      ${shown.length - junkCount > 300 ? `<div>… ${shown.length - junkCount - 300} more</div>` : ""}</div>`;
  }

  function renderTable(body, p) {
    const t = p.table || { columns: [], rows: [] };
    body.innerHTML = `<div class="table-scroll"><table class="data-table"><thead><tr>${t.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
      <tbody>${t.rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  function renderSheets(body, p) {
    body.innerHTML = (p.sheets || []).map((s) => `<div class="viewer-note" style="padding:10px 14px"><b>Sheet: ${esc(s.name)}</b></div>
      <div class="table-scroll"><table class="data-table"><tbody>${(s.rows || []).map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`).join("");
  }

  function renderCodebook(body, p) {
    const v = p.variables || [];
    body.innerHTML = `<div class="table-scroll"><table class="data-table"><thead><tr><th>Variable</th><th>Label</th><th>Type</th><th>Missing</th><th>Value labels</th></tr></thead>
      <tbody>${v.map((x) => `<tr><td class="mono">${esc(x.variable)}</td><td>${esc(x.label || "")}</td><td>${esc(x.type)}</td><td>${esc(x.n_missing)}</td><td>${esc((x.value_labels || []).join("; "))}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function renderOutline(body, p) {
    const o = p.outline || [];
    body.innerHTML = `<div class="viewer-note" style="padding:12px 14px">XML root: <span class="mono">${esc((p.meta || {}).root || "")}</span></div>
      <ol class="items">${o.map((r) => `<li><div class="meta">${esc(r.routine || r.element || "")}</div><div>${esc((r.components || []).join(", ") || r.count || "")}</div></li>`).join("")}</ol>`;
  }

  async function renderCode(body, url, lang) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    let text = await r.text();
    const cut = text.length > 300000;
    if (cut) text = text.slice(0, 300000);
    const pre = document.createElement("pre");
    pre.className = "code";
    const code = document.createElement("code");
    code.textContent = text;
    if (window.hljs && lang && lang !== "plaintext" && window.hljs.getLanguage(lang)) {
      code.innerHTML = window.hljs.highlight(text, { language: lang }).value;
    }
    pre.appendChild(code);
    body.innerHTML = "";
    body.appendChild(pre);
    if (cut) body.insertAdjacentHTML("beforeend", note("Preview truncated at 300 KB."));
  }

  /* ----------------------------------------------------------- render --- */
  STAC.preview = {
    _token: 0,

    async render(viewer, file, instrument) {
      const token = ++STAC.preview._token;
      const body = viewer.querySelector(".viewer-body");
      const type = file.preview.type;
      const url = file.preview.url;
      STAC.api.track("preview", instrument.id, file.name);

      try {
        if (!url || type === "none") {
          body.innerHTML = note(`<b>No in-browser preview for ${esc(file.format_label)} files.</b>
            ${file.notes ? `<span>${esc(file.notes)}</span>` : ""}
            <span>Download the file or open it on GitHub.</span>`);
          return;
        }
        switch (type) {
          case "pdf-native":
          case "pdf-convert":
            await renderPdf(body, url, token);
            break;
          case "sheet": {
            const json = url.replace(/\.pdf$/, ".json");
            try { renderSheets(body, await fetchJSON(json)); }
            catch { await renderPdf(body, url, token); }
            break;
          }
          case "qsf-items":
          case "que-items":
          case "lss-items":
            renderItems(body, await fetchJSON(url));
            break;
          case "zip-tree": renderZip(body, await fetchJSON(url)); break;
          case "table": renderTable(body, await fetchJSON(url)); break;
          case "codebook": renderCodebook(body, await fetchJSON(url)); break;
          case "xml-outline": renderOutline(body, await fetchJSON(url)); break;
          case "code":
          case "markdown":
            await renderCode(body, url, file.preview.highlight || (type === "markdown" ? "markdown" : "plaintext"));
            break;
          case "image":
            body.innerHTML = `<div style="padding:12px;display:grid;place-items:center"><img src="${esc(url)}" alt="${esc(file.name)}" style="max-width:100%;height:auto"></div>`;
            break;
          case "media":
            body.innerHTML = /^video/.test(file.mime)
              ? `<video controls src="${esc(url)}" style="width:100%"></video>`
              : `<div class="viewer-note"><audio controls src="${esc(url)}"></audio></div>`;
            break;
          default:
            body.innerHTML = note("No preview available.");
        }
      } catch (e) {
        if (token !== STAC.preview._token) return;
        body.innerHTML = note(`${icon("alert")} <b>Preview not available.</b>
          <span>The preview for this file has not been generated yet (run scripts/04_build_previews.R) or could not be loaded.</span>`);
      }
    }
  };
})();
