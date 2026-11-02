# OSF after the migration: frozen record, growing GitHub archive

STAC will keep growing on GitHub while the OSF project stays as it was on the migration day. This document fixes how the two relate, so that nobody who follows the link in the paper ends up with an outdated view without knowing it.

## Principle

| | OSF project 4s9p6 | GitHub `stac-archive/stac` |
|---|---|---|
| Role | Frozen legacy record (state of the migration day) | The living archive |
| New instruments, translations, fixes | never | only here, through reviewed pull requests |
| DOI | `10.17605/OSF.IO/4S9P6` stays valid | Zenodo concept DOI (always latest) plus one DOI per release |
| Cited in the paper | yes (`osf.io/4s9p6`, Table SI1 at `osf.io/a5cps`) | from now on |
| Download counts | keep growing; read monthly (`osf-legacy-stats.yml`) | release bundles plus website counter |

## Release 1 equals the OSF snapshot

Tag the very first GitHub release `v2026.10.0-osf-snapshot` from the migration commit, before any curation. Its Zenodo record then contains exactly the OSF content (byte-identical, see `migration/osf_path_map.csv`) and links to the OSF DOI with `isNewVersionOf`. Every later release (`v2026.11.0`, ...) adds new instruments and fixes. Anyone can show what changed since OSF by comparing the two tags on GitHub.

## What to change on OSF (once, on migration day)

Do **not** delete, move or rename files on OSF. Links in the paper and in other publications point to file GUIDs (for example the supplemental table `osf.io/a5cps`), and the OSF download counters belong to those files.

1. **Project description** (replace the first sentence, keep the rest):

   > STAC has moved to GitHub: https://stac-archive.github.io/stac/ (catalog) and https://github.com/stac-archive/stac (repository). This OSF project is the frozen record of STAC as of [DATE] and receives no further updates. New scales, tasks and translations are added on GitHub only.

2. **Wiki home** (top of the page):

   > **Note: this archive is frozen as of [DATE].** The current STAC, including all instruments added since then, lives at https://stac-archive.github.io/stac/. Each instrument page there lists its version history; the first GitHub release (`v2026.10.0-osf-snapshot`, Zenodo DOI [DOI]) is identical to this OSF project.

3. **Notice file** at the top of OSF Storage: upload `00_STAC_HAS_MOVED.md` (template below). The leading zeros sort it above the section folders.

4. **Tags**: add `moved-to-github`.

5. **Optional: GitHub add-on.** OSF can show a connected GitHub repository in the project's Files tab. Then visitors who arrive through the paper see the current files next to the frozen OSF Storage. Two caveats:
   * The OSF connection syncs in both directions. Connect it with a GitHub account that has only **Read** access to the repository (or rely on the `main` branch ruleset), so that nobody can push to the archive from OSF and bypass the review.
   * OSF does not archive add-on content; the frozen record remains OSF Storage only.

   Recommendation: connect it. It costs nothing and catches visitors who never read the description.

## Template: `00_STAC_HAS_MOVED.md`

```markdown
# STAC has moved to GitHub

This OSF project is the frozen record of STAC (Scales and Tasks for Art and
Creativity Assessment) as of [DATE]. It is kept online because publications
cite it, but it receives no further updates.

- Current catalog with search and previews: https://stac-archive.github.io/stac/
- Repository (all files, version history): https://github.com/stac-archive/stac
- New and updated instruments (Atom feed): https://stac-archive.github.io/stac/feed.xml
- Latest version DOI (Zenodo concept DOI): [DOI]
- First GitHub release, identical to this OSF project: [DOI of v2026.10.0-osf-snapshot]

Please cite the original source of each instrument version and, if helpful,
Kenett, Silvia & Benedek (2026), https://doi.org/10.1027/2698-1866/a000140.
```

## How the GitHub side shows the split

* Every instrument has an origin: **OSF archive (frozen Oct 2026)** or **Added on GitHub**. New ones carry a *New* badge, can be filtered (facet *Origin*) and sorted (*Recently added or changed*).
* `stac.yml`: legacy instruments have `provenance.osf_path` and `migrated`; new ones have `provenance.added` (set automatically by the intake script).
* `site/feed.xml` lists new and changed instruments, so researchers can subscribe.
* Each release ships `stac-catalog-<tag>.csv`, the successor of Table SI1.
* The dashboard shows OSF downloads (frozen copy, refreshed monthly) and GitHub downloads separately and counts instruments added since the freeze.

## Why not keep OSF in sync automatically?

Technically, a workflow could upload every release to OSF Storage through the OSF API. It is not recommended: it creates a second copy that can drift, doubles the moderation effort when something has to be withdrawn, and splits download counts across two places. A frozen record plus clear pointers is easier to explain and to maintain. If the moderators still want a mirror, it should be one-way (GitHub to OSF), triggered only by releases, and write into a separate OSF component so the frozen record stays untouched.
