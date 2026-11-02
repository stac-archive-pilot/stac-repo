/* STAC message board.
 * Public discussion lives in GitHub Discussions (embedded with giscus when
 * configured). Visitors without a GitHub account write through the backend:
 * private messages and anonymous reports go to a private inbox repository,
 * public posts are moderated before they appear. */
(function () {
  "use strict";
  const STAC = (window.STAC = window.STAC || {});
  const { esc, icon } = STAC;

  const TABS = [
    ["public", "Public board"],
    ["private", "Private message"],
    ["error", "Report an error"],
    ["missing", "Request a measure"],
    ["access", "Request access"]
  ];

  function instrumentOptions(state, selected) {
    return `<option value="">General / not about one instrument</option>` +
      state.items.map((it) => `<option value="${esc(it.id)}" ${it.id === selected ? "selected" : ""}>${esc(it.display)}${it.acronym ? " · " + esc(it.title) : ""}</option>`).join("");
  }

  function staticNotice(kind) {
    const text = {
      private: "This prototype has no backend connected, so private messages cannot be delivered yet. In the deployed version the message goes to the moderators' private inbox and you receive a ticket number.",
      access: "Access requests need the backend. Moderators review each request and send a download link that expires after 7 days.",
      public: "Posting without a GitHub account needs the backend. With a GitHub account you can post directly in GitHub Discussions."
    }[kind];
    return text ? `<div class="notice warn">${icon("alert")}<div>${esc(text)}</div></div>` : "";
  }

  function formHtml(kind, state, preset) {
    const common = `
      <div class="field"><label for="m-instrument">Instrument</label><select id="m-instrument">${instrumentOptions(state, preset)}</select></div>`;
    const who = `
      <div class="cols-2">
        <div class="field"><label for="m-name">Name or pseudonym <span class="hint">(optional)</span></label><input id="m-name" maxlength="80" placeholder="Shown only if your post is public"></div>
        <div class="field"><label for="m-email">E-mail <span class="hint">(optional, never published)</span></label><input id="m-email" type="email" maxlength="200" placeholder="So that moderators can reply"></div>
      </div>`;
    const forms = {
      private: `${common}
        <div class="field"><label for="m-subject">Subject</label><input id="m-subject" required maxlength="140"></div>
        <div class="field"><label for="m-body">Message</label><textarea id="m-body" required maxlength="8000" placeholder="Only the moderators can read this."></textarea></div>${who}`,
      error: `${common}
        <div class="field"><label for="m-subject">What is wrong?</label>
          <select id="m-subject"><option>Wrong or missing item</option><option>Wrong citation or reference</option><option>File does not open or import</option><option>Survey file broken on a platform</option><option>Translation error</option><option>Other</option></select></div>
        <div class="field"><label for="m-body">Details</label><textarea id="m-body" required maxlength="8000" placeholder="Which file, which item, which platform version?"></textarea></div>
        <label class="switch"><input type="checkbox" id="m-anon" checked> Report anonymously (goes to the private inbox, not to a public issue)</label>${who}`,
      missing: `
        <div class="field"><label for="m-subject">Measure</label><input id="m-subject" required maxlength="140" placeholder="Name and acronym"></div>
        <div class="field"><label for="m-doi">Publication DOI</label><input id="m-doi" maxlength="200" placeholder="10.xxxx/…"></div>
        <div class="field"><label for="m-body">Why should STAC include it?</label><textarea id="m-body" required maxlength="8000" placeholder="Construct, languages, whether the authors allow open sharing …"></textarea></div>${who}`,
      access: `${common.replace("General / not about one instrument", "Choose the restricted instrument")}
        <div class="cols-2">
          <div class="field"><label for="m-name">Name</label><input id="m-name" required maxlength="80"></div>
          <div class="field"><label for="m-email">Institutional e-mail</label><input id="m-email" type="email" required maxlength="200"></div>
        </div>
        <div class="field"><label for="m-inst">Institution</label><input id="m-inst" required maxlength="200"></div>
        <div class="field"><label for="m-use">Intended use</label><select id="m-use"><option value="academic">Academic research or teaching</option><option value="commercial">Commercial</option><option value="other">Other</option></select></div>
        <div class="field"><label for="m-body">Purpose</label><textarea id="m-body" required maxlength="4000" placeholder="Study, sample, timeline"></textarea></div>`,
      public: `${common}
        <div class="field"><label for="m-subject">Title</label><input id="m-subject" required maxlength="140"></div>
        <div class="field"><label for="m-body">Post</label><textarea id="m-body" required maxlength="8000"></textarea><span class="hint">Moderated before it appears. Markdown is not rendered.</span></div>${who}`
    };
    const submitLabel = { private: "Send to moderators", error: "Send report", missing: "Send request", access: "Request access", public: "Submit for moderation" }[kind];
    return `<form class="form" id="msg-form" data-kind="${kind}" novalidate>
      ${forms[kind]}
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-primary" type="submit">${icon("chat")} ${submitLabel}</button>
        <span class="hint" style="font-size:var(--fs-xs);color:var(--ink-3)">Protected against spam with Cloudflare Turnstile in the deployed version.</span>
      </div>
      <div id="msg-result" aria-live="polite"></div>
    </form>`;
  }

  async function publicBoard(el, state) {
    const giscus = state.catalog.giscus || {};
    let html = `<div class="cols-2">
      <div class="card"><h3>Discussions on GitHub</h3>
        <p style="font-size:var(--fs-sm);color:var(--ink-2)">Questions about administration and scoring, feedback on instruments, studies that used a measure, and ideas for STAC. Threads are public and searchable.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <a class="btn btn-primary" href="${esc(STAC.api.discussionsUrl())}" target="_blank" rel="noopener">${icon("chat")} Open discussions</a>
          <a class="btn" href="${esc(STAC.api.discussionsUrl("q-a"))}" target="_blank" rel="noopener">Q&amp;A</a>
          <a class="btn" href="${esc(STAC.api.discussionsUrl("used-in-research"))}" target="_blank" rel="noopener">Used in research</a>
        </div></div>
      <div class="card"><h3>Without a GitHub account</h3>
        <p style="font-size:var(--fs-sm);color:var(--ink-2)">Write here instead. A moderator approves the post, which then appears below and, if useful, in GitHub Discussions under your chosen name.</p>
        <p style="margin-top:12px"><button class="btn" type="button" data-goto-tab="publicform">${icon("plus")} Write a public post</button></p></div>
    </div>
    <div class="card"><h3>Recent approved posts</h3><div id="board-list"></div></div>`;
    el.innerHTML = html;
    const list = el.querySelector("#board-list");
    if (!STAC.api.enabled) {
      list.innerHTML = `<p style="font-size:var(--fs-sm);color:var(--ink-2)">No posts yet. Posts appear here once the backend runs${giscus.repo_id ? "" : " and Discussions are enabled"}.</p>`;
      return;
    }
    try {
      const posts = await STAC.api.board();
      list.innerHTML = posts.length ? posts.map((p) => `<div class="msg"><b>${esc(p.subject)}</b><div class="who">${esc(p.created_at.slice(0, 10))} · ${esc(p.author_display)}${p.instrument_id ? " · " + esc((state.byId.get(p.instrument_id) || {}).display || p.instrument_id) : ""}</div><p>${esc(p.body)}</p></div>`).join("") : "<p>No posts yet.</p>";
    } catch {
      list.innerHTML = "<p>Posts could not be loaded.</p>";
    }
  }

  async function submit(form, state) {
    const kind = form.dataset.kind === "publicform" ? "public" : form.dataset.kind;
    const val = (id) => { const e = form.querySelector("#" + id); return e ? (e.type === "checkbox" ? e.checked : e.value.trim()) : ""; };
    const out = form.querySelector("#msg-result");
    const missing = [...form.querySelectorAll("[required]")].filter((e) => !e.value.trim());
    if (missing.length) {
      out.innerHTML = `<div class="notice warn">${icon("alert")}<div>Please fill in: ${missing.map((e) => esc(form.querySelector(`label[for="${e.id}"]`).textContent.replace(/\(.*\)/, "").trim())).join(", ")}.</div></div>`;
      missing[0].focus();
      return;
    }
    const instrument_id = val("m-instrument") || undefined;
    const it = instrument_id ? state.byId.get(instrument_id) : null;

    // Static mode: public issues go to GitHub with prefilled forms
    if (!STAC.api.enabled) {
      if (kind === "error" && !val("m-anon")) {
        const url = STAC.api.issueUrl("03-error-report.yml", `[Error]: ${it ? it.display : ""} ${val("m-subject")}`, { instrument: instrument_id, description: val("m-body") });
        out.innerHTML = `<div class="notice ok">${icon("check")}<div>Your report is ready as a GitHub issue. <a href="${esc(url)}" target="_blank" rel="noopener">Open the prefilled issue</a> and submit it there.</div></div>`;
        return;
      }
      if (kind === "missing") {
        const url = STAC.api.issueUrl("04-missing-instrument.yml", `[Request]: ${val("m-subject")}`, { instrument: val("m-subject"), publication_doi: val("m-doi"), rationale: val("m-body") });
        out.innerHTML = `<div class="notice ok">${icon("check")}<div>Your request is ready as a GitHub issue. <a href="${esc(url)}" target="_blank" rel="noopener">Open the prefilled issue</a> and submit it there.</div></div>`;
        return;
      }
      out.innerHTML = staticNotice(kind === "error" ? "private" : kind) ||
        `<div class="notice warn">${icon("alert")}<div>No backend connected in this prototype.</div></div>`;
      return;
    }

    // Backend mode
    try {
      let res;
      if (kind === "access") {
        res = await STAC.api.post("/v1/access-requests", {
          instrument_id, name: val("m-name"), email: val("m-email"), institution: val("m-inst"),
          purpose: val("m-body"), intended_use: val("m-use"), turnstile_token: window.STAC_TURNSTILE_TOKEN || ""
        });
      } else {
        const subject = kind === "missing" ? `${val("m-subject")}${val("m-doi") ? " (" + val("m-doi") + ")" : ""}` : val("m-subject");
        res = await STAC.api.post("/v1/messages", {
          kind, instrument_id, subject, body: val("m-body"), name: val("m-name") || undefined, email: val("m-email") || undefined,
          visibility: kind === "public" ? "public" : "private", optin_id: STAC.api.optinId() || undefined,
          turnstile_token: window.STAC_TURNSTILE_TOKEN || ""
        });
      }
      form.reset();
      out.innerHTML = `<div class="notice ok">${icon("check")}<div>${kind === "public" ? "Thanks. Your post waits for moderation." : "Delivered to the moderators."} Ticket <b class="mono">${esc(res.ticket)}</b>.</div></div>`;
    } catch (e) {
      out.innerHTML = `<div class="notice warn">${icon("alert")}<div>${esc(e.message)}. Check the fields and try again.</div></div>`;
    }
  }

  STAC.board = {
    pendingTab: null,

    render(root, state, tab) {
      if (!TABS.some(([k]) => k === tab) && tab !== "publicform") tab = "public";
      root.innerHTML = `
        <div class="page-head"><p class="eyebrow">Community</p><h1>Message board</h1>
          <p>Ask questions, report problems, request measures, or write to the moderators privately. Public discussion runs on GitHub Discussions; everything else works without a GitHub account.</p></div>
        <div class="seg" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-btab="${k}" aria-selected="${k === tab || (tab === "publicform" && k === "public")}">${esc(l)}</button>`).join("")}</div>
        <div id="board-body"></div>`;
      const body = root.querySelector("#board-body");
      const show = (k) => {
        root.querySelectorAll("[data-btab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.btab === k || (k === "publicform" && b.dataset.btab === "public")));
        if (k === "public") { publicBoard(body, state); return; }
        const kind = k === "publicform" ? "public" : k;
        body.innerHTML = `<div class="cols-2" style="align-items:start">
          <div>${formHtml(kind, state, state.open ? state.open.id : "")}</div>
          <div class="panel">${!STAC.api.enabled ? staticNotice(kind) : ""}
            <div class="notice">${icon("lock")}<div>${{
              private: "Private messages go to a private repository that only moderators can read. Your e-mail address is never shown publicly.",
              error: "Anonymous reports are private. Without the anonymous option the report becomes a public GitHub issue, which needs a GitHub account.",
              missing: "Requests are public GitHub issues so others can support them. Mention whether the authors allow open sharing.",
              access: "Restricted materials are not stored in the public repository. After approval you receive a personal link valid for 7 days.",
              public: "Public posts are moderated. Do not include personal data of others."
            }[kind]}</div></div></div>
        </div>`;
        const form = body.querySelector("#msg-form");
        if (k === "publicform") form.dataset.kind = "publicform";
        form.addEventListener("submit", (e) => { e.preventDefault(); submit(form, state); });
      };
      root.querySelector(".seg").addEventListener("click", (e) => { const b = e.target.closest("[data-btab]"); if (b) show(b.dataset.btab); });
      root.addEventListener("click", (e) => { const g = e.target.closest("[data-goto-tab]"); if (g) show(g.dataset.gotoTab); });
      show(tab);
    },

    /** Discussion tab inside an instrument dossier. */
    mountInstrumentThread(el, it) {
      const cfg = (STAC.state.catalog.giscus || {});
      const disc = STAC.api.discussionsUrl("instrument-feedback");
      el.innerHTML = `<div class="cols-2" style="align-items:start">
        <div class="card"><h3>Discussion about ${esc(it.display)}</h3>
          <div id="giscus-slot"></div>
          ${cfg.repo_id ? "" : `<p style="font-size:var(--fs-sm);color:var(--ink-2)">Each instrument gets its own thread in GitHub Discussions (category “Instrument feedback”, embedded here with giscus). Enable Discussions and fill in <span class="mono">giscus.repo_id</span> and <span class="mono">category_id</span> in <span class="mono">config/site.yml</span>.</p>`}
          <p style="margin-top:12px"><a class="btn" href="${esc(disc)}" target="_blank" rel="noopener">${icon("chat")} Open on GitHub</a></p>
        </div>
        <div class="panel">
          <a class="btn" href="#/board?tab=private" data-board-tab="private">${icon("lock")} Write privately to the moderators</a>
          <a class="btn" href="#/board?tab=error" data-board-tab="error">${icon("flag")} Report an error anonymously</a>
          <a class="btn" href="${esc(STAC.api.issueUrl("02-new-language-version.yml", `[Language version]: ${it.display} in <language>`, { instrument: it.id }))}" target="_blank" rel="noopener">${icon("globe")} Contribute a language version</a>
        </div>
      </div>`;
      if (cfg.repo_id && cfg.category_id) {
        const s = document.createElement("script");
        s.src = "https://giscus.app/client.js";
        Object.entries({
          "data-repo": cfg.repo, "data-repo-id": cfg.repo_id, "data-category": cfg.category, "data-category-id": cfg.category_id,
          "data-mapping": "specific", "data-term": `instrument:${it.id}`, "data-reactions-enabled": "1", "data-input-position": "top",
          "data-theme": "preferred_color_scheme", "data-lang": "en", crossorigin: "anonymous"
        }).forEach(([k, v]) => s.setAttribute(k, v));
        s.async = true;
        el.querySelector("#giscus-slot").appendChild(s);
      }
    }
  };
})();
