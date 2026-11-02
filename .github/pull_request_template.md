<!--
Thanks for contributing to STAC. Please fill in what applies and delete the rest.
Contributing without git? Use the issue form "Submit a new instrument" instead:
https://github.com/stac-archive/stac/issues/new/choose
-->

## What does this pull request do?

<!-- One or two sentences. Link related issues with "Closes #123" so they close on merge. -->

Closes #

**Type of change**

- [ ] New instrument
- [ ] New language version of an existing instrument
- [ ] Correction of instrument files (items, scoring key, broken file)
- [ ] Metadata or README correction
- [ ] Infrastructure (scripts, site, worker, workflows, schema)
- [ ] Documentation or governance

## Checklist for instrument changes

**Inclusion criteria** (see [CONTRIBUTING.md](https://github.com/stac-archive/stac/blob/main/CONTRIBUTING.md#inclusion-criteria))

- [ ] (1) The construct is relevant to creativity, aesthetics or the arts, or is an individual difference of interest in this context.
- [ ] (2) The measure is published in a peer-reviewed journal with basic psychometric evidence (DOI in `stac.yml` under `references`).
- [ ] (3) I have permission to share these files openly (author, translator, or written permission).
- [ ] (4) Files come with a README covering files, administration and scoring, citation per language version, and the statement that use is free for academic and non-commercial purposes.

**Folder and files**

- [ ] The folder is `instruments/<section>/[<subsection>/]<instrument-slug>/` with a lowercase, hyphenated slug.
- [ ] New files follow `ACRONYM_Language[_Platform][_Variant].ext`. Files migrated from OSF keep their original names.
- [ ] No junk files (`.DS_Store`, `Thumbs.db`, `__MACOSX/`, `~$` lock files, `.git` inside zips).
- [ ] No file is larger than 50 MB (the validator errors above 95 MB).
- [ ] No restricted material is committed. Files with access tier `restricted` go to the moderators, not into git.

**Metadata**

- [ ] `stac.yml` is present and every file in the folder is listed under `files` with `language`, `format` and `role`.
- [ ] Each language version has its own reference (APA 7, DOI as link).
- [ ] `access.tier` and `access.statement` match the licence given by the authors.
- [ ] Contributors are listed with ORCID where available.
- [ ] `version` is increased if existing files changed in substance (item text, scoring).

**Checks**

- [ ] `Rscript scripts/07_validate.R` passes locally, or I rely on the `validate` check in this pull request.

## Checklist for infrastructure changes

- [ ] The change keeps the repository layout and the `stac.yml` schema backward compatible, or the migration is described below.
- [ ] Workflows use pinned major versions and minimal permissions; no secret is printed or passed to untrusted code.
- [ ] Documentation (README, CONTRIBUTING, GOVERNANCE) is updated if behaviour changed.

## Notes for reviewers

<!-- Anything curators should look at in particular: sources you checked, open questions, screenshots. -->
