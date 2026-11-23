import { adaptiveCard, escapeMd, openUrl, postCard, text } from './teams.js';

const TOKEN = process.env.GITHUB_TOKEN;
const REPOS = (process.env.REPOS || process.env.GITHUB_REPOSITORY || '')
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);
const STALE_DAYS = Number(process.env.STALE_DAYS || 5);
const MAX_LISTED = Number(process.env.MAX_LISTED || 5);
const DAY_MS = 86_400_000;

if (!TOKEN) throw new Error('GITHUB_TOKEN is not set');
if (REPOS.length === 0) throw new Error('No repositories configured (set REPOS or GITHUB_REPOSITORY)');

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function paginate(path) {
  const all = [];
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const items = await gh(`${path}${sep}per_page=100&page=${page}`);
    all.push(...items);
    if (items.length < 100) return all;
  }
}

// Latest non-comment review per reviewer decides the PR's review state.
function reviewState(reviews) {
  const latest = new Map();
  for (const r of reviews) {
    if (r.state === 'COMMENTED' || r.state === 'PENDING') continue;
    latest.set(r.user.login, r.state);
  }
  const states = [...latest.values()];
  if (states.includes('CHANGES_REQUESTED')) return 'changes_requested';
  if (states.includes('APPROVED')) return 'approved';
  return 'awaiting_review';
}

async function loadPrs(repo) {
  const prs = await paginate(`/repos/${repo}/pulls?state=open&sort=created&direction=asc`);
  return Promise.all(
    prs.map(async (pr) => {
      const reviews = pr.draft ? [] : await paginate(`/repos/${repo}/pulls/${pr.number}/reviews`);
      return {
        repo,
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        author: pr.user.login,
        draft: pr.draft,
        ageDays: Math.floor((Date.now() - Date.parse(pr.created_at)) / DAY_MS),
        idleDays: Math.floor((Date.now() - Date.parse(pr.updated_at)) / DAY_MS),
        review: pr.draft ? 'draft' : reviewState(reviews),
      };
    }),
  );
}

const prs = (await Promise.all(REPOS.map(loadPrs))).flat();
const count = (fn) => prs.filter(fn).length;
const stale = prs.filter((p) => !p.draft && p.idleDays >= STALE_DAYS).sort((a, b) => b.idleDays - a.idleDays);
const waiting = prs.filter((p) => p.review === 'awaiting_review').sort((a, b) => b.ageDays - a.ageDays);

const line = (p) =>
  `- [${escapeMd(REPOS.length > 1 ? `${p.repo}#${p.number}` : `#${p.number}`)} ${escapeMd(p.title)}](${p.url}) — ${p.author}, ${p.idleDays}d idle`;

const section = (title, list) =>
  list.length === 0
    ? []
    : [
        text(`**${title}**`, { spacing: 'Medium' }),
        text(list.slice(0, MAX_LISTED).map(line).join('\n'), { spacing: 'None' }),
        ...(list.length > MAX_LISTED ? [text(`…and ${list.length - MAX_LISTED} more`, { isSubtle: true, spacing: 'None' })] : []),
      ];

const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

const body =
  prs.length === 0
    ? [text(`☀️ PR digest · ${date}`, { weight: 'Bolder', size: 'Medium' }), text('🎉 No open pull requests. Inbox zero!')]
    : [
        text(`☀️ PR digest · ${date}`, { weight: 'Bolder', size: 'Medium' }),
        text(REPOS.join(', '), { isSubtle: true, spacing: 'None' }),
        {
          type: 'FactSet',
          facts: [
            { title: 'Open PRs', value: String(prs.length) },
            { title: 'Drafts', value: String(count((p) => p.draft)) },
            { title: 'Awaiting review', value: String(waiting.length) },
            { title: 'Changes requested', value: String(count((p) => p.review === 'changes_requested')) },
            { title: 'Approved, ready to merge', value: String(count((p) => p.review === 'approved')) },
            { title: `Stale (${STALE_DAYS}+ days idle)`, value: String(stale.length) },
            { title: 'Oldest open', value: `${Math.max(...prs.map((p) => p.ageDays))} days` },
          ],
        },
        ...section('🕸️ Stale', stale),
        ...section('⏳ Waiting longest for a review', waiting),
      ];

const actions = REPOS.length === 1 ? [openUrl('All open PRs', `https://github.com/${REPOS[0]}/pulls`)] : [];
await postCard(process.env.TEAMS_WEBHOOK_URL, adaptiveCard(body, actions));
console.log(`Digest posted: ${prs.length} open, ${stale.length} stale`);
