# Privacy notice (template)

> **Status: draft template.** This text describes how the STAC website and backend are designed to handle personal data. It is **not yet a legally reviewed privacy policy**. Before the site goes live, the hosting institution must fill in the placeholders marked `[TO BE COMPLETED]`, confirm that the description matches the deployed configuration, and have the text reviewed by its data protection officer.

Last updated: [TO BE COMPLETED]

## 1. Who is responsible

- **Controller:** [TO BE COMPLETED: name and address of the institution or person responsible for the STAC website and backend]
- **Contact for privacy questions:** [TO BE COMPLETED: email address]
- **Data protection officer:** [TO BE COMPLETED: name or office and contact, if applicable]

## 2. What this notice covers

STAC consists of:

1. the **website** `https://stac-archive.github.io/stac/`, a static site hosted on GitHub Pages;
2. a small **backend** (a Cloudflare Worker) that counts page views and downloads, receives private messages and access requests, and serves restricted materials;
3. the public **GitHub repository** `stac-archive/stac` with its issues and discussions.

## 3. Website and backend

### What we do not do

- No cookies are set by STAC.
- No advertising, no third-party tracking or analytics services, no fingerprinting.
- IP addresses and full user-agent strings are **not stored** by STAC.

### Usage statistics

To show how often measures are viewed and downloaded, the backend counts events such as "instrument page viewed" or "file downloaded". For each event it stores:

- the event type, the instrument or file concerned, and the date;
- coarse technical categories derived at the time of the request (for example device class or country) [TO BE COMPLETED: confirm the exact categories stored];
- a **visitor hash**: a one-way hash of the IP address and user-agent combined with a secret salt that **changes every day** and is then discarded. The hash allows counting unique visitors per day; it cannot be reversed, and the same visitor cannot be recognised across days.

Retention: individual events are deleted after **90 days**. Aggregated counts (for example "120 downloads in March") contain no personal data and are kept indefinitely; they are published on the website.

### Optional pseudonym

Visitors can choose a pseudonym (for example to sign comments on the board or to see their own previous messages). The pseudonym is stored **only in your browser** (local storage) and sent with the messages you choose to send. You can delete it at any time by clearing the site data in your browser. [TO BE COMPLETED: confirm whether the pseudonym is also stored server side with messages.]

### Private messages, anonymous reports and access requests

When you use the private message form, the anonymous report form, or request access to restricted materials:

- the content of your message and any contact details you provide (for example name, email address, institution, intended use) are transmitted to the backend and stored as an issue in a **private** GitHub repository (`stac-archive/stac-inbox`) that only the STAC moderators can read;
- anonymous reports are stored without contact details. Please do not include information that identifies you if you want to stay anonymous;
- email addresses are used only to answer your message or to send you access to requested materials, and are never published;
- for approved access requests, the backend keeps a record of who was granted access to which material and when (admin log), to document compliance with the authors' conditions.

Retention: messages and access requests are kept as long as needed to handle them, and deleted at the latest [TO BE COMPLETED: e.g. 2 years] after the matter is closed, unless the authors' licence conditions require a longer record of access grants.

### Hosting providers

- **GitHub Pages** (GitHub, Inc.) delivers the website. GitHub may process technical data such as IP addresses in server logs for security and operation. See the [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
- **Cloudflare** (Cloudflare, Inc.) runs the backend and stores restricted files and statistics. Cloudflare processes request data to deliver the service. See the [Cloudflare Privacy Policy](https://www.cloudflare.com/privacypolicy/).

[TO BE COMPLETED: data processing agreements, transfers to third countries (both providers are US companies) and the safeguards relied on, for example the EU-US Data Privacy Framework or standard contractual clauses.]

## 4. GitHub: issues, discussions, pull requests and comments

If you use your GitHub account to open an issue, start a discussion, comment (also through the comment widget on the website, which uses GitHub Discussions via giscus) or contribute a pull request:

- your contribution and your GitHub user name are **public**;
- information you enter in issue forms (for example names and ORCIDs of contributors) becomes part of the public archive metadata;
- the processing of your account data by GitHub is governed by GitHub's own terms and privacy statement, not by this notice. STAC moderators can moderate, hide or lock content, but cannot fully erase content from GitHub's systems or from forks.

Do not post personal data of other people (for example their email addresses) in public issues or discussions.

## 5. Legal basis

[TO BE COMPLETED by the hosting institution, for example:]

- usage statistics: legitimate interest in understanding the use of the archive and reporting to funders (Art. 6(1)(f) GDPR) [or public interest task, Art. 6(1)(e) GDPR, for public institutions];
- messages and access requests: steps at your request and handling of your enquiry (Art. 6(1)(b) or (f) GDPR);
- record of access grants: compliance with the conditions set by the rights holders (Art. 6(1)(f) GDPR).

## 6. Your rights

Under the GDPR you have the right to access, rectification, erasure, restriction of processing, data portability and objection, and the right to lodge a complaint with a supervisory authority [TO BE COMPLETED: competent authority]. Because usage statistics are stored only as daily-salted hashes, we generally cannot link them to you. To exercise your rights regarding messages or access requests, contact [TO BE COMPLETED: contact].

## 7. Changes

Changes to this notice are made through pull requests in this repository, so every version is publicly documented in the git history.
