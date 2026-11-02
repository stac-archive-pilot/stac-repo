# Governance of STAC

STAC (Scales and Tasks for Art and Creativity Assessment) is a curated, community-maintained archive of measures for research on creativity, aesthetics and the arts. It was founded on OSF ([https://osf.io/4s9p6](https://osf.io/4s9p6), DOI [10.17605/OSF.IO/4S9P6](https://doi.org/10.17605/OSF.IO/4S9P6)) and is described in:

Kenett, Y. N., Silvia, P. J., & Benedek, M. (2026). Scales and Tasks for Art and Creativity Assessment (STAC). *Psychological Test Adaptation and Development, 7*, 239-244. [https://doi.org/10.1027/2698-1866/a000140](https://doi.org/10.1027/2698-1866/a000140)

This document explains who decides what, how people join and leave, and how the archive stays available when people move on. Technical permissions are listed in [governance/roles-matrix.md](governance/roles-matrix.md).

## Principles

- **Curation over volume.** Every measure meets the inclusion criteria in [CONTRIBUTING.md](CONTRIBUTING.md#inclusion-criteria). Accuracy of items, scoring keys and citations matters more than speed.
- **Credit to authors and translators.** Each language version carries its own reference, and contributors are named in the metadata.
- **Open by default, honest about limits.** Everything in this repository is public. Materials that may not be redistributed freely are kept out of it.
- **Decisions in the open.** Content decisions are made in public issues and pull requests. Only matters involving personal data, unpublished materials or legal questions are handled privately.

## Roles

| Role | Who | Responsibilities |
|---|---|---|
| **Moderators** | The STAC founders and people they appoint (team `moderators`, organisation owners) | Scope and inclusion criteria, access tiers, appointment of curators, conflicts, settings and secrets, the private inbox. Currently Mathias Benedek (University of Graz), Yoed N. Kenett (Technion) and Paul J. Silvia (UNC Greensboro). |
| **Section maintainers** | Curators with merge rights for one section (teams `aesthetics-curators`, `creativity-curators`, `personality-curators`) | Review and merge contributions to their section, check measures against the inclusion criteria, keep metadata consistent. |
| **Curators** | Volunteers who help with triage (team `curators`) | Label and answer issues, check submissions, contact authors, help contributors. |
| **Infra maintainers** | Team `infra` | R pipeline, website, worker, workflows. They do not decide on content. |
| **Worker admins** | Members of the Cloudflare Access approvers group | Handle access requests for restricted materials. |
| **Contributors** | Anyone who submits a measure, a translation, a correction or code | See [CONTRIBUTING.md](CONTRIBUTING.md). |

## How decisions are made

| Decision | Who decides | How |
|---|---|---|
| Adding or updating an instrument in a section | One section maintainer (or a moderator) | Approving review on the pull request. The `validate` check must pass. |
| Corrections of items, keys or citations | One section maintainer | Approving review. Substantial changes to item wording or scoring raise `version` in `stac.yml` and are noted in the README. |
| Removing an instrument | Moderators | Majority of moderators, with a public note in the issue. The reason is recorded. Files remain in the git history; if removal is legally required, moderators decide on further steps. |
| Disputes about inclusion (does a measure meet the criteria?) | Moderators | Majority of moderators, after hearing the section maintainers and the contributor. |
| Access tier other than `academic-noncommercial` or `open` | Moderators | Explicit approval by at least one moderator in the pull request. |
| Changes to `schema/`, `governance/`, inclusion criteria, this document | Moderators | Pull request open for at least 7 days for comments, then approval by a majority of moderators. |
| Infrastructure changes | Infra maintainers | Approving review by an infra code owner. Changes that affect contributors (schema, forms, URLs) also need a moderator. |
| Appointing and removing curators | Moderators | See below. |

Routine work follows **lazy consensus**: if a reasonable proposal receives no objection within its review period, it can go ahead. Anyone can ask for a decision to be escalated to the moderators.

Conflicts of interest: nobody approves their own contribution. A maintainer who is an author of a submitted measure asks another maintainer or a moderator to review it.

## Review times

These are goals for a volunteer project, not guarantees.

| Step | Target |
|---|---|
| First response to a new issue or pull request (label, thank, ask for missing information) | within 7 days |
| Error reports concerning item text or scoring keys | triaged within 7 days, fixed or labelled `status:blocked` within 30 days |
| Decision on a new instrument or language version once all information is complete | within 30 days |
| Private messages and access requests | first response within 14 days |

Items with no activity for 60 days get the label `status:stale` and a reminder. Submissions waiting for information from the contributor for 90 days may be closed and can be reopened at any time.

## Becoming a curator

1. Contribute: submit or review measures, translations or corrections, answer questions in Discussions.
2. Express interest by opening a private message through the website or by asking a moderator. Existing curators can also nominate people.
3. Moderators decide by majority and announce the appointment in Discussions. New curators start in the `curators` team (Triage). After a period of reliable reviews, usually about three months, moderators can add them to a section team (merge rights).

Curators are expected to know the inclusion criteria, follow the [Code of Conduct](CODE_OF_CONDUCT.md), and respond to review requests within the targets above or tell the team when they are unavailable.

## Security requirements for all role holders

- **Two-factor authentication is mandatory** for every member of the `stac-archive` organisation (enforced in the organisation settings). Accounts without 2FA are removed automatically by GitHub.
- Use personal accounts, no shared logins. Tokens used by workflows (`STATS_TOKEN`, `INTAKE_TOKEN`, `CLOUDFLARE_API_TOKEN`) are fine-grained, limited to the repositories they need and have an expiry date.
- Cloudflare Access for worker admins uses the organisation's identity provider or one-time email codes, never shared passwords.

## Offboarding

When someone leaves a role, voluntarily or after 12 months without activity (after a reminder):

1. Remove them from all GitHub teams and, if applicable, from the organisation owners.
2. Remove them from Cloudflare Access groups and the Cloudflare account.
3. Remove them from `stac-archive/stac-inbox`.
4. Rotate every secret they could have seen: tokens they created, `CLOUDFLARE_API_TOKEN`, worker runtime secrets they had access to. Tokens created by a person stop working when that person loses access, so replace them before removing the account.
5. Update the access register (below) and thank them publicly, if they agree, in the list of former curators in the README.

Former curators stay credited as contributors in the metadata of everything they worked on.

## Succession and continuity

The archive must outlive any individual role holder. The following rules keep it that way:

- **At least three organisation owners from at least two institutions** at all times. If this falls below three, the remaining moderators appoint new ones within 60 days.
- **No single point of failure for infrastructure.** Every secret, token and external account (GitHub organisation, Cloudflare account, domain if any, Zenodo community) has at least two administrators. Tokens belong to bot or machine accounts or GitHub Apps where possible, not to personal accounts.
- **Access register.** Moderators keep a private register (in `stac-archive/stac-inbox`) listing each external account, who administers it, which secrets exist, where they are used and when they expire. It is reviewed once a year together with team membership.
- **Independent copies.** Each release is archived on Zenodo through the GitHub integration (with a DOI), so the content survives the loss of the GitHub organisation. The OSF project remains as the legacy record.
- **Hand-over to an institution.** If the moderators can no longer maintain STAC, they transfer the organisation to a research institution or society that commits to the principles above, or, as a last resort, archive the repository (read-only) with a notice pointing to the Zenodo records.
- **Inactive moderators.** A moderator who has not responded for 12 months, after reminders, can be moved to emeritus status by the remaining moderators.

## Changes to this document

Changes follow the procedure for governance changes above: a pull request open for at least 7 days and approval by a majority of moderators.
