# Licensing

> **Status: proposal.** The legacy OSF project (osf.io/4s9p6) had no license set. The terms below are the proposed structure for the GitHub repository and must be confirmed by the STAC moderators before the repository is made public.

STAC holds three kinds of content, and each has its own terms.

## 1. Instrument materials (`instruments/**`, except `stac.yml`)

Scales, tasks, scoring keys and translations remain the intellectual property of their authors. They are shared in STAC with the authors' permission (STAC inclusion criterion 3; Kenett, Silvia & Benedek, 2026).

* The access tier in each instrument's `stac.yml` (`access.tier`, `access.statement`) is the binding statement for that instrument. The default tier is **free for academic and non-commercial use**.
* Commercial use requires the permission of the rights holder named in the instrument's references.
* Tiers that do not allow open redistribution (`permission-required`, `restricted`) are never committed to this public repository.
* Published article PDFs stored next to some instruments are the publishers' works; their redistribution is being checked (see the migration audit).

## 2. Code (`scripts/`, `site/`, `worker/`, `.github/`)

Proposed: MIT License. Copyright (c) 2026 the STAC moderators and contributors.

## 3. Catalog metadata (`stac.yml`, `config/`, `site/data/catalog.json`)

Proposed: CC0 1.0 Universal, so that the catalog can be harvested and reused freely (for example by ZIS, the Open Test Archive or search engines).

## The STAC paper

`docs/paper/` contains Kenett, Silvia & Benedek (2026), published by Hogrefe as an OpenMind article under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
