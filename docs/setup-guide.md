# Setup guide

Two ways to run STAC before it goes public: **A** on your own computer (no GitHub, no internet needed once installed) and **B** as a real GitHub pilot that nobody else sees yet.

## Why double-clicking `index.html` does not work

The catalog loads `site/data/catalog.json` and the previews with `fetch()`. Browsers block that for pages opened from disk (`file://`). The site therefore needs a small local web server. In addition, `catalog.json`, `previews/` and `files/` are **generated** by the R pipeline and are not stored in Git, so a fresh checkout has no data until you build it.

---

## A. Local, offline

### A1. Install once

| Tool | Needed for | Windows | macOS | Linux |
|---|---|---|---|---|
| R ≥ 4.3 (RStudio optional) | pipeline | cran.r-project.org | cran.r-project.org | `apt install r-base` |
| R packages | pipeline | see below | see below | see below |
| LibreOffice | Word/Excel/PowerPoint previews (optional) | libreoffice.org (default path is found automatically) | libreoffice.org | `apt install libreoffice` |
| mdbtools | MediaLab `.que` previews (optional) | not available natively: use WSL, or skip (GitHub Actions builds them) | `brew install mdbtools` | `apt install mdbtools` |
| Python 3 *or* R package httpuv | local web server | either | either | either |

```r
install.packages(c("dplyr", "purrr", "tidyr", "stringr", "tibble", "glue", "fs", "yaml",
                   "jsonlite", "readr", "digest", "commonmark", "xml2", "readxl",
                   "haven", "httr2", "httpuv"))
```

All JavaScript libraries and fonts are part of the repository (`site/assets/vendor/`), so the website itself needs no internet connection.

### A2. Get the files

* **Full ZIP**: unzip, done.
* **Lite ZIP** (no instrument files): unzip, then restore the files 1:1 from the OSF download:

```bash
cd stac-repo
Rscript scripts/01_migrate_osf_archive.R /path/to/unzipped/osfstorage-archive
```

The script copies all 313 files, checks every SHA-256 against the originals and stops if anything differs.

### A3. Build

From the repository root (the folder with `config/`, `scripts/`, `site/`), or in RStudio after opening `stac.Rproj`:

```bash
Rscript scripts/run_build.R          # full build: catalog, previews, stats, README, validation
Rscript scripts/run_build.R --quick  # catalog only, about 30 seconds
```

`run_build.R` first checks R packages, locale, LibreOffice and mdbtools and tells you what is missing. Missing LibreOffice or mdbtools only means fewer previews; the catalog still works. On Linux or macOS, if R warns about the locale, start it with `LANG=en_US.UTF-8 Rscript ...`.

### A4. Serve and open

```bash
Rscript scripts/serve.R              # or: cd site && python -m http.server 8000   (Windows: py -m http.server 8000)
```

Open http://localhost:8000. Stop the server with Ctrl+C.

What works offline: search, filters, all previews that were built, dashboard (with demo data switch), citations, quality tab. What does not: GitHub links (the organisation does not exist yet), downloads of release bundles, the message board backend (shows how it will behave instead).

### A5. Optional: test the backend locally

Requires Node.js 18 or newer.

```bash
cd worker
node test/run-tests.mjs              # 21 tests, no network needed
npx wrangler d1 execute stac-db --local --file=schema.sql   # local SQLite copy of D1
cp .dev.vars.example .dev.vars        # fill in test secrets
npx wrangler dev                      # API on http://localhost:8787
```

Set `backend.api_base: "http://localhost:8787"` in `config/site.yml`, set `ALLOWED_ORIGINS=http://localhost:8000` in `.dev.vars` (overrides the value in `wrangler.toml` for local runs), and rebuild with `run_build.R --quick`. Turnstile can use Cloudflare's published test keys.

---

## B. GitHub pilot (real GitHub, not public yet)

### B1. Decide how private the pilot is

| Option | Repository | Website | Cost |
|---|---|---|---|
| **B-1 private (recommended)** | private repo in a new organisation | not published; download the built site from each Actions run and open it locally (A4) | free |
| B-2 private repo with Pages | private | GitHub Pages | needs GitHub Team (or Pro for a personal account). The Pages site itself is still reachable by anyone who knows the URL. |
| B-3 public but unannounced | public | Pages under a neutral name, `noindex` | free, but visible to anyone |

### B2. Create organisation and repositories

1. Create an organisation (e.g. `stac-archive-pilot`). Require two-factor authentication for members.
2. Create teams: `moderators`, `aesthetics-curators`, `creativity-curators`, `personality-curators`, `infra`. Give the curator teams **Maintain** (GitHub accepts only teams with write access as code owners).
3. Create the repositories `stac` (private for B-1) and `stac-inbox` (always private).
4. Replace the placeholder `stac-archive` with your organisation name in `config/site.yml`, `CITATION.cff`, `.github/CODEOWNERS`, `.github/ISSUE_TEMPLATE/config.yml` and `README.md` (search and replace `stac-archive/stac`).

### B3. Push

```bash
cd stac-repo
git init -b main          # skip if the folder already has a .git
git add -A
git commit -m "Migrate STAC 1:1 from OSF project 4s9p6"
git remote add origin https://github.com/<org>/stac.git
git push -u origin main
```

The full repository is about 140 MB. `POLYFT_IDGRP.zip` (79.5 MB) triggers GitHub's warning for files above 50 MB, but stays below the 100 MB limit, so no Git LFS is needed.

### B4. Settings

* **Actions**: Settings, Actions, General: allow GitHub Actions to create pull requests.
* **Pages** (B-2/B-3 only): source "GitHub Actions".
* **Discussions**: enable; create the categories `q-a`, `instrument-feedback`, `used-in-research`, `ideas` (slugs must match `.github/DISCUSSION_TEMPLATE/`).
* **Rulesets**: import `governance/rulesets/main-protection.json` and `stats-branch.json` (replace `"actor_id": 0` with the moderators team id; see `governance/roles-matrix.md`).
* **Labels**: run the workflow *labels-sync* once (Actions tab, Run workflow).
* **Secrets**: `STATS_TOKEN` (fine-grained token for this repo with Administration: read-only) for the traffic archive. Cloudflare secrets only once you test the backend.

### B5. First runs

1. Actions, *build-deploy*, Run workflow. For B-1 the deploy step fails because Pages is off; the build artifact `github-pages` still contains the complete site: download, unzip, serve locally (A4).
2. Actions, *traffic-archive*, Run workflow (creates the `stats` branch).
3. Actions, *osf-legacy-stats*, Run workflow (reads the current OSF download counts).
4. Test the contribution path: open an issue with the *New instrument* form, attach a small zip, and as a curator comment `/accept`. A draft pull request with folder, `stac.yml` and README appears; *validate* runs on it.

### B6. Zenodo in the pilot

Do not connect the real Zenodo during the pilot: every release would mint a permanent DOI. Use the Zenodo sandbox (sandbox.zenodo.org) with the same GitHub integration to test `.zenodo.json`, then switch to the real Zenodo on launch day and publish the first release `v2026.10.0-osf-snapshot` (see `osf-after-migration.md`).

### B7. Pilot checklist before going public

- [ ] Moderators have decided licensing (LICENSE.md) and the data controller (PRIVACY.md)
- [ ] Curators have worked through the most visible audit items (licenses, NA citations of the top-downloaded instruments)
- [ ] Contribution path tested end to end with one real new instrument
- [ ] Backend deployed, privacy notice approved by the data protection officer
- [ ] OSF texts prepared (`osf-after-migration.md`)
- [ ] Organisation renamed or repository transferred to its final name; placeholders replaced
