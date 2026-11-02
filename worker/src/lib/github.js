/**
 * GitHub integration.
 *
 *  - createInboxIssue: REST "create an issue" in the PRIVATE inbox repo
 *    (env.INBOX_REPO, e.g. "stac-archive/stac-inbox").
 *  - createDiscussion: GraphQL createDiscussion in the PUBLIC repo
 *    (env.DISCUSSIONS_REPO_ID + env.DISCUSSIONS_CATEGORY_ID, both GraphQL
 *    node ids), used when a moderator approves a public message.
 *
 * Token: env.GITHUB_TOKEN, a fine-grained personal access token or GitHub
 * App token with "Issues: read and write" on the inbox repo and
 * "Discussions: read and write" on the public repo. If the two repos live
 * under different owners, set env.GITHUB_DISCUSSIONS_TOKEN for the latter.
 *
 * All visitor-supplied text is rendered inertly: bodies go into fenced code
 * blocks (no Markdown, HTML, images or @mentions), single-line fields are
 * Markdown-escaped and @mentions are broken with a zero-width space.
 */

const API = 'https://api.github.com';

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'stac-api-worker',
    'Content-Type': 'application/json',
  };
}

/** True when issues can be created in the inbox repo. */
export function inboxConfigured(env) {
  return Boolean(env.GITHUB_TOKEN && env.INBOX_REPO && /^[\w.-]+\/[\w.-]+$/.test(env.INBOX_REPO));
}

/** True when approved public messages can be mirrored to Discussions. */
export function discussionsConfigured(env) {
  return Boolean(
    (env.GITHUB_DISCUSSIONS_TOKEN || env.GITHUB_TOKEN) && env.DISCUSSIONS_REPO_ID && env.DISCUSSIONS_CATEGORY_ID,
  );
}

/**
 * Create an issue in the private inbox repo.
 * @returns {Promise<{number: number, url: string}>}
 */
export async function createInboxIssue(env, { title, body, labels }) {
  const res = await fetch(`${API}/repos/${env.INBOX_REPO}/issues`, {
    method: 'POST',
    headers: headers(env.GITHUB_TOKEN),
    body: JSON.stringify({ title: title.slice(0, 256), body, labels }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`GitHub issue creation failed: HTTP ${res.status} ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  return { number: data.number, url: data.html_url };
}

const CREATE_DISCUSSION = `
mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
  createDiscussion(input: {repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body}) {
    discussion { number url }
  }
}`;

/**
 * Create a discussion in the public repo, posted by the token's bot user.
 * @returns {Promise<{number: number, url: string}>}
 */
export async function createDiscussion(env, { title, body }) {
  const res = await fetch(`${API}/graphql`, {
    method: 'POST',
    headers: headers(env.GITHUB_DISCUSSIONS_TOKEN || env.GITHUB_TOKEN),
    body: JSON.stringify({
      query: CREATE_DISCUSSION,
      variables: {
        repositoryId: env.DISCUSSIONS_REPO_ID,
        categoryId: env.DISCUSSIONS_CATEGORY_ID,
        title: title.slice(0, 256),
        body,
      },
    }),
  });
  const data = await res.json().catch(() => null);
  const discussion = data?.data?.createDiscussion?.discussion;
  if (!res.ok || !discussion || data.errors) {
    const detail = data?.errors ? JSON.stringify(data.errors).slice(0, 300) : `HTTP ${res.status}`;
    throw new Error(`GitHub createDiscussion failed: ${detail}`);
  }
  return { number: discussion.number, url: discussion.url };
}

/** Break @mentions so pasted text never pings GitHub users or teams. */
export function neutralizeMentions(s) {
  return String(s).replace(/@(?=[A-Za-z0-9_-])/g, '@\u200B');
}

/** Escape a single-line value for inline Markdown. */
export function escapeInline(s) {
  return neutralizeMentions(String(s).replace(/[\\`*_{}[\]()#+!|<>~]/g, '\\$&'));
}

/** Wrap multi-line text in a fenced code block that it cannot break out of. */
export function fenced(s) {
  const longestRun = Math.max(0, ...(String(s).match(/`+/g) || []).map((m) => m.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}text\n${s}\n${fence}`;
}

/** Render a Markdown blockquote from (moderated) public text. */
export function blockquote(s) {
  return neutralizeMentions(s)
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}
