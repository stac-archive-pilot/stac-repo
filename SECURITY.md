# Security policy

This policy covers the STAC website (`https://stac-archive.github.io/stac/`), the Cloudflare Worker backend in [`worker/`](worker/), the GitHub Actions workflows in [`.github/workflows/`](.github/workflows/) and the R scripts in [`scripts/`](scripts/).

## Reporting a vulnerability

Please **do not report security problems in public issues or discussions.**

Use one of these private channels:

1. **GitHub private vulnerability reporting** (preferred): go to the [Security tab](https://github.com/stac-archive/stac/security) of this repository and click "Report a vulnerability". Only the moderators and infra maintainers can see the report.
2. **Email:** [TO BE COMPLETED: security contact address]

Please include:

- what is affected (page, endpoint, workflow, script) and how you found the problem;
- steps to reproduce, or a proof of concept;
- the possible impact (for example access to restricted materials, to private messages or access requests, to secrets, or the ability to change published content);
- whether you want to be credited, and under which name.

## What to expect

- Acknowledgement within **5 working days**.
- An initial assessment within **14 days**, including whether we consider it a security issue and how we plan to fix it.
- We ask you to give us **90 days** (or until a fix is released, if earlier) before public disclosure. We will keep you informed and credit you in the fix announcement if you wish.

STAC is maintained by volunteers and has no bug bounty programme.

## Scope

In scope, for example:

- ways to download restricted materials without an approved access request;
- ways to read private messages, access requests, the admin log, or raw statistics;
- bypassing Cloudflare Access on admin routes;
- injection through issue forms or pull requests that makes a workflow run attacker-controlled code with repository secrets or write permissions;
- cross-site scripting or content injection on the website (for example through instrument metadata or README rendering);
- leaking of secrets in logs or artifacts.

Out of scope:

- vulnerabilities in GitHub, GitHub Pages or Cloudflare themselves (report them to those vendors);
- the fact that files in this repository are public: this is by design, see [governance/roles-matrix.md](governance/roles-matrix.md);
- denial-of-service attacks, spam and social engineering of maintainers;
- findings from automated scanners without a demonstrated impact.

## Good-faith research

We will not take action against people who report vulnerabilities in good faith, avoid privacy violations and data destruction, do not access more data than needed to demonstrate the problem, and give us reasonable time to fix it. Please do not access or download other people's messages or access requests; demonstrating that you could is enough.

## For maintainers

- Enable private vulnerability reporting (Settings > Code security) and secret scanning with push protection.
- Workflows request minimal permissions per job, pin actions to major versions (Dependabot keeps them current), and never interpolate issue or pull request text directly into shell commands.
- After an incident: rotate the affected secrets (`STATS_TOKEN`, `INTAKE_TOKEN`, `CLOUDFLARE_API_TOKEN`, worker runtime secrets), review the admin log and the Actions run history, and document the incident in the private inbox repository.
