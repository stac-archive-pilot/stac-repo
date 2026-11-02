# Contributing to STAC

Thank you for helping STAC grow. STAC is a living archive and depends on researchers who share their measures, translations and corrections. You do **not** need to know git: most contributions can be made through a web form.

- [Ways to contribute](#ways-to-contribute)
- [Inclusion criteria](#inclusion-criteria)
- [Route 1: no git, use an issue form](#route-1-no-git-use-an-issue-form)
- [Route 2: git, fork and pull request](#route-2-git-fork-and-pull-request)
- [Folder structure](#folder-structure)
- [File naming](#file-naming)
- [The README](#the-readme)
- [The metadata file stac.yml](#the-metadata-file-stacyml)
- [What happens after you submit](#what-happens-after-you-submit)

By contributing you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

| You want to | Use |
|---|---|
| Submit a new scale, task or scoring method | [Submit a new instrument](https://github.com/stac-archive/stac/issues/new?template=01-new-instrument.yml) |
| Add a translation or adaptation of an archived measure | [Add a language version](https://github.com/stac-archive/stac/issues/new?template=02-new-language-version.yml) |
| Report a wrong item, scoring key, citation or a broken file | [Report an error](https://github.com/stac-archive/stac/issues/new?template=03-error-report.yml) |
| Suggest a measure that is missing | [Request a missing instrument](https://github.com/stac-archive/stac/issues/new?template=04-missing-instrument.yml) |
| Fix catalog information (title, keywords, ORCID, ...) | [Correct metadata](https://github.com/stac-archive/stac/issues/new?template=05-metadata-correction.yml) or a pull request |
| Ask about permitted use | [Licensing question](https://github.com/stac-archive/stac/issues/new?template=06-license-question.yml) |
| Ask a question, share experience, share a study that used a measure | [Discussions](https://github.com/stac-archive/stac/discussions) |
| Contact the moderators privately | [Private message form](https://stac-archive.github.io/stac/#/board?tab=private) |

## Inclusion criteria

New contributions need to meet the four criteria set out by the STAC founders (Kenett et al., 2026):

1. **Scope.** The measure captures psychological constructs relevant to creativity, aesthetics or the arts at large, or captures individual differences in personality or cognitive ability that are of interest in this context.
2. **Peer review.** The measure was published in a peer-reviewed journal, demonstrating basic evidence of psychometric quality.
3. **Permission to share.** The contributors have permission to share the materials openly; typically, they are authors of the measure and the resulting publication, or have developed a translation of it. Measures that require permission or a licence to be used are not included. (Exceptions are possible only when the moderators agree to a different access tier, see below.)
4. **Usable documentation.** The contributors provide the measure and clear accompanying information that enables others to use it as intended: a `README.md` that gives an overview of the files, relevant information on administration and scoring, and how to cite the measure (separate references for each language version). The README confirms that the measure is free to use for academic and non-commercial purposes.

Kenett, Y. N., Silvia, P. J., & Benedek, M. (2026). Scales and Tasks for Art and Creativity Assessment (STAC). *Psychological Test Adaptation and Development, 7*, 239-244. [https://doi.org/10.1027/2698-1866/a000140](https://doi.org/10.1027/2698-1866/a000140)

### Access tiers

Every instrument has an access tier in `stac.yml` (`access.tier`):

| Tier | Meaning | Files in the public repository? |
|---|---|---|
| `open` | Free for any purpose with citation | yes |
| `academic-noncommercial` | Free for academic and non-commercial use (the STAC default) | yes |
| `research-only` | Free for research use only | yes |
| `permission-required` | Users must ask the authors before use | yes, only if the authors agree that the files may be public |
| `commercial-with-permission` | Free for academic use; commercial use needs permission | yes |
| `restricted` | Files may not be distributed publicly | **no**: files are held by the moderators and released on approved request |

Tiers other than `open` and `academic-noncommercial` need explicit approval by a moderator.

> **Important:** this repository is public. Anything committed, attached to an issue or pushed to a pull request branch can be downloaded by anyone and stays in the history. Never upload materials you may not share openly. Send restricted materials through the [private message form](https://stac-archive.github.io/stac/#/board?tab=private) instead.

## Route 1: no git, use an issue form

1. Sign in to GitHub (a free account is enough) and open [Submit a new instrument](https://github.com/stac-archive/stac/issues/new?template=01-new-instrument.yml) or [Add a language version](https://github.com/stac-archive/stac/issues/new?template=02-new-language-version.yml).
2. Fill in the form. It asks for the same information as the `stac.yml` metadata file and the README.
3. **Drag and drop your files** into the "Files" box. GitHub accepts common formats such as `.pdf`, `.docx`, `.xlsx`, `.pptx`, `.odt`, `.txt`, `.md`, `.csv`, `.png`, `.jpg` and `.zip`, up to 25 MB per file. Put survey and experiment files that GitHub does not accept (`.qsf`, `.que`, `.lss`, `.psyexp`, MATLAB or R code) into a `.zip`.
4. Submit. A bot builds a draft entry from your answers, checks it, and posts the result as a comment. If something is missing you can edit the issue.
5. A curator reviews the submission, may ask questions, and opens a pull request with the finished entry. You will be mentioned and credited.

## Route 2: git, fork and pull request

1. Fork `stac-archive/stac` and create a branch, for example `add-kdocs-german`.
2. Add or change files following the [folder structure](#folder-structure), [file naming](#file-naming), [README](#the-readme) and [stac.yml](#the-metadata-file-stacyml) conventions below.
3. Optional but helpful: run the validator from the repository root.
   ```sh
   Rscript scripts/07_validate.R
   ```
   It checks `stac.yml` against `schema/stac-instrument.schema.json`, that all listed files exist, that README and files match, file sizes, and junk files.
4. Open a pull request against `main` and complete the checklist in the template. The `validate` check runs automatically. Section curators are requested as reviewers automatically.

Keep one instrument (or one language version) per pull request. Large binary files: the validator warns above 50 MB and fails above 95 MB per file.

## Folder structure

```
instruments/
  art-and-aesthetics/
    <instrument-slug>/
  creativity/
    self-report-scales/
      <instrument-slug>/
    tasks/
      <instrument-slug>/
      methods-and-scoring/
        <instrument-slug>/
  personality-and-individual-differences/
    <instrument-slug>/
```

Each instrument folder contains:

- the instrument files (questionnaires, task materials, survey exports, scoring sheets, stimuli),
- `README.md` for people,
- `stac.yml` for machines (catalog, website, validation).

The **slug** is the acronym in lowercase with hyphens, for example `k-docs`, `aut`, `hexaco-pi-r`. Use only `a-z`, `0-9` and `-`. If two measures share an acronym, add a distinguishing word (`caq-creative-achievement`).

Files migrated from the original OSF archive keep their original names and contents 1:1; do not rename them in unrelated pull requests, because external links and citations may point to them.

## File naming

New files follow this pattern:

```
ACRONYM_Language[_Platform][_Variant].ext
```

| Part | Rules | Examples |
|---|---|---|
| `ACRONYM` | As in the publication, keep capitalisation and hyphens | `K-DOCS`, `AUT`, `HEXACO-PI-R` |
| `Language` | English name of the language, capitalised. Several languages in one file: join with hyphens | `English`, `German`, `Farsi`, `English-German` |
| `Platform` (optional) | Only for platform-specific files | `Qualtrics`, `MediaLab`, `PsychoPy`, `MATLAB`, `LimeSurvey`, `SoSciSurvey`, `UniparkEFS`, `REDCap` |
| `Variant` (optional) | Short form, version, item set, scoring material | `Short`, `100items`, `Scoring`, `Manual`, `FormB` |

Examples: `K-DOCS_English.pdf`, `K-DOCS_German.docx`, `AFS_English_MediaLab.que`, `HEXACO-PI-R_English_100items.doc`, `AUT_German_Qualtrics_Short.qsf`, `DAT_English_Scoring.xlsx`.

Avoid spaces, umlauts and special characters in file names. Do not commit `.DS_Store`, `Thumbs.db`, `~$` lock files, `__MACOSX/` folders or `.git` folders inside zip archives; the validator rejects them.

## The README

Each instrument folder has a `README.md` based on the [STAC README template](templates/README_Template.md). It contains:

1. **Overview**: what the measure assesses, its dimensions or subscales, number of items or trials, response format, target population.
2. **Files**: one bullet per file with a short description.
3. **Administration and scoring**: instructions, time limits, scoring rules, reverse-keyed items, or a pointer to the relevant pages of the manual or paper.
4. **Citation**: the reference(s) to cite, **separately for each language version** where they differ, in APA 7 with DOI links.
5. **Licensing**: the statement that the files are free to use for academic and non-commercial purposes, or the exact terms of the access tier.

The README and `stac.yml` must describe the same set of files. The validator reports drift between them.

## The metadata file `stac.yml`

`stac.yml` is the machine-readable twin of the README and is validated against [`schema/stac-instrument.schema.json`](schema/stac-instrument.schema.json). The schema is authoritative; the example below shows the main fields.

```yaml
schema_version: 1
id: k-docs
acronym: K-DOCS
title: Kaufman Domains of Creativity Scale
section: creativity
subsection: self-report-scales
kind: scale            # scale | task | method
summary: >
  50-item self-report measure of creativity in five domains
  (Everyday, Scholarly, Performance, Scientific, Artistic).
tags: [creative self-concept, domains of creativity]
access:
  tier: academic-noncommercial
  statement: Free to use for academic and non-commercial purposes.
files:
  - path: K-DOCS_English.pdf
    language: English
    format: pdf
    role: instrument   # instrument | scoring | instructions | manual | reference | stimuli | software | data | figure
    citation: kaufman2012
  - path: K-DOCS_German.docx
    language: German
    format: docx
    role: instrument
    citation: german-version
references:
  # one entry per reference, cited from files[].citation
administration:
  # duration, instructions, scoring
contributors:
  - name: James C. Kaufman
    orcid: 0000-0000-0000-0000
    role: author
status: published
version: 1.0.0
```

Use `platform` for survey files (`qualtrics`, `medialab`, ...) and `languages` (a list) instead of `language` for multilingual files. When item text or scoring of an existing file changes in substance, increase `version` and mention the change in the README.

## What happens after you submit

1. A curator labels the issue or pull request within about a week.
2. The curator checks the inclusion criteria, the publication, permissions and the files. They may contact you with questions (label `status:needs-info`).
3. For issue-form submissions, the curator comments `/accept`. A bot then opens a draft pull request with the entry, which the curator completes.
4. A section maintainer approves and merges. The website updates automatically, usually within an hour, and the measure appears in the next release bundle.

Decisions and timelines are described in [GOVERNANCE.md](GOVERNANCE.md). Questions about the process are welcome in [Discussions](https://github.com/stac-archive/stac/discussions/categories/q-a).
