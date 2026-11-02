# STAC roles and permissions

This matrix describes who can read and change what in the STAC archive. It covers the public GitHub repository `stac-archive/stac`, the private inbox repository `stac-archive/stac-inbox`, the website on GitHub Pages and the Cloudflare Worker backend. [GOVERNANCE.md](../GOVERNANCE.md) explains how people get into and out of these roles.

## Two facts that shape everything

1. **The repository is public. Every committed file is readable and downloadable by anyone, forever.** This includes the full git history, every branch (including `stats`), every release asset, issue attachments and Actions logs of public workflows. Deleting a file later does not remove it from the history or from forks. Therefore:
   - Materials with access tier `restricted` (and anything else that may not be redistributed freely) **must never be committed**, not even temporarily in a pull request. They are stored in the private Cloudflare R2 bucket and handed out by the worker after an approved access request, or deposited as a restricted-access record on Zenodo.
   - Messages, email addresses and access requests never go into the public repository. The worker writes them to the private repository `stac-archive/stac-inbox`.
2. **GitHub's custom repository roles exist only on GitHub Enterprise Cloud.** STAC uses the five base roles (Read, Triage, Write, Maintain, Admin), assigned through organisation teams, and narrows them with `CODEOWNERS` and repository rulesets. There is no GitHub setting that limits a team's write access to one folder; per-section control comes from the rule that a pull request can only be merged into `main` after a code owner of every changed path has approved it.

## Teams

| Team | Repository role on `stac` | Role on `stac-inbox` | Purpose |
|---|---|---|---|
| `moderators` | Admin | Admin | Scientific leadership, final decisions, settings, secrets. Organisation owners. |
| `aesthetics-curators` | Maintain | none | Section maintainers for `instruments/art-and-aesthetics/` (code owners). |
| `creativity-curators` | Maintain | none | Section maintainers for `instruments/creativity/` (code owners). |
| `personality-curators` | Maintain | none | Section maintainers for `instruments/personality-and-individual-differences/` (code owners). |
| `curators` | Triage | Triage (optional, for access requests) | All curators, including people who triage without merge rights. Parent team of the three section teams. |
| `infra` | Write | none | Code owners of `scripts/`, `site/`, `worker/`, `config/`, `.github/`. |

Notes:

- Child teams inherit the parent's access, so section maintainers are automatically in `curators`. Triage access is repository-wide by nature: a triage curator can label and close issues of every section, but cannot change any file. Per-section triage is a matter of assignment (filter by `section:` label), not of permission.
- GitHub only accepts teams with **Write or higher** as code owners. An approval from someone with Triage access is visible but does not count towards the required review.
- Every code-owner team should have **at least two members**, because nobody can approve their own pull request. Moderators are co-owners of all sections, so a section never blocks.

## Matrix: GitHub repository `stac-archive/stac`

R = read, C = comment or open, W = write or change, M = moderate (label, close, lock, hide), A = administer. "PR" means the change goes through a reviewed pull request.

| What | Visitor (no account) | GitHub user | Contributor (fork + PR) | Curator (Triage) | Section maintainer (Maintain via section team) | Infra maintainer (Write via `infra`) | Moderator (Admin, org owner) |
|---|---|---|---|---|---|---|---|
| Instrument files and READMEs | R, download | R, fork | R, propose via PR | R, propose via PR | W in own section via PR (needs own team's or a moderator's approval); approves PRs in own section | R, propose via PR | W everywhere via PR; approves any PR |
| `stac.yml` metadata | R | R | propose via PR | propose via PR | W in own section via PR | propose via PR | W via PR |
| `schema/`, `governance/`, `templates/`, `CODEOWNERS`, root policies | R | R | propose via PR | propose via PR | propose via PR | propose via PR | W via PR, approves |
| `scripts/`, `site/`, `worker/`, `.github/workflows/` | R | R | propose via PR | propose via PR | propose via PR | W via PR, approves | W via PR, approves |
| Issues | R | C | C | M | M | M | M, delete |
| Discussions | R | C | C | M | M, manage categories | M | M, manage categories |
| Labels | R | R | R | apply | apply, create and edit | apply, create and edit | all |
| Releases and bundles | R, download | R, download | R, download | R | create and edit releases | create and edit releases | all |
| Branches other than `main` | R | R | in own fork only | none | push, delete unprotected | push, delete unprotected | all |
| `main` | R | R | merge only via PR | none | merge PRs that pass the ruleset | merge PRs that pass the ruleset | merge; bypass ruleset via PR in emergencies |
| Traffic insights (GitHub UI) | none | none | none | none | R (push access) | R (push access) | R |
| Archived traffic snapshots (`stats` branch) and `site/data/stats.json` | R (aggregates only, public) | R | R | R | R | R | R, A |
| Actions logs and artifacts | R | R | R | R | R, re-run | R, re-run | R, re-run, delete |
| Secrets (`STATS_TOKEN`, `INTAKE_TOKEN`, `CLOUDFLARE_*`) | none | none | none | none | none | none (use only, through workflows) | A |
| Rulesets, settings, Pages, team membership | none | none | none | none | none | none | A |

## Matrix: private inbox and backend

| What | Visitor (no account) | GitHub user | Curator (Triage) | Section maintainer | Infra maintainer | Worker admin (Cloudflare Access) | Moderator |
|---|---|---|---|---|---|---|---|
| Send a private message or anonymous report (site form) | C | C | C | C | C | C | C |
| Read private messages (`stac-inbox` issues) | none | none | only if added to `stac-inbox` | none | none | none, unless also moderator | R, reply, close |
| Submit an access request for restricted materials | C | C | C | C | C | C | C |
| Read access requests (`stac-inbox`, label `access-request`) | none | none | R if added to `stac-inbox` | none | none | R | R |
| Approve or deny access requests | none | none | none | none | none | W (approvers group) | W |
| Restricted files in the R2 bucket | none | none | none | none | none | W (upload, revoke) | W |
| Admin log (worker audit trail of approvals, uploads, config changes) | none | none | none | none | R | R | R |
| Raw page-view events (salted hashes, kept 90 days) | none | none | none | none | R (debugging) | R | R |
| Aggregated statistics | R (public) | R | R | R | R | R | R |
| Worker code and deployment | R (code is public) | R | R | R | W via PR; deploys through `worker-deploy.yml` | none | W, A |
| Worker runtime secrets (salt, inbox token, mail keys) | none | none | none | none | set via `wrangler secret` if granted Cloudflare access | none | A |
| Cloudflare account, Access policies, domain | none | none | none | none | as delegated | none | A |

**Worker admin** is not a GitHub role. It is membership in a Cloudflare Access policy group (for example `stac-access-approvers`) that protects the worker's admin routes. Login is via an identity provider configured in Cloudflare Zero Trust (GitHub or one-time email code). Membership is granted and removed by moderators and listed in the private access register (see GOVERNANCE.md).

## Applying the configuration

1. Create the teams in the organisation and give them the repository roles above (Settings > Collaborators and teams).
2. Require two-factor authentication for the organisation (Organisation settings > Authentication security).
3. Import `governance/rulesets/main-protection.json` (Settings > Rules > Rulesets > New ruleset > Import a ruleset). Before importing, replace `"actor_id": 0` with the numeric id of the `moderators` team:
   `gh api orgs/stac-archive/teams/moderators --jq .id`
   The ruleset requires a pull request with one approving review including a code owner review, the status check `validate` (from `.github/workflows/validate.yml`, GitHub Actions app id 15368), and blocks force pushes and deletion of `main`. Moderators can bypass only through a pull request (`bypass_mode: pull_request`).
4. Import `governance/rulesets/stats-branch.json` the same way. It prevents deletion and history rewrites of the `stats` branch, which holds the only long-term copy of the traffic data. Replace `actor_id` as above.
5. Settings > Actions > General: allow GitHub Actions to create pull requests (needed by `intake.yml`), keep the default `GITHUB_TOKEN` permission at read-only (workflows request what they need per job).
6. Settings > Pages: source "GitHub Actions". Settings > Environments: create `github-pages` (restricted to `main`) and `cloudflare` (restricted to `main`, holding `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`).
7. Settings > General > Features: enable Discussions and create the categories with these slugs: `q-a` (Q&A format), `instrument-feedback`, `used-in-research`, `ideas`. The forms in `.github/DISCUSSION_TEMPLATE/` attach to categories by slug.
8. Run the `labels-sync` workflow once (Actions > labels-sync > Run workflow).
