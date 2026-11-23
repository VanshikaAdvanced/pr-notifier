import { adaptiveCard, escapeMd, openUrl, postCard, text } from './teams.js';

const TOKEN = process.env.GH_PAT;
const REPOS = (process.env.REPOS || '').split(',').map((r) => r.trim()).filter(Boolean);
const THIS_REPO = process.env.GITHUB_REPOSITORY;
const WORKFLOW_FILE = process.env.WORKFLOW_FILE || 'pr-alerts.yml';
const FALLBACK_MINUTES = 15;

if (!TOKEN) throw new Error('GH_PAT is not set');
if (REPOS.length === 0) throw new Error('REPOS is not set (comma-separated owner/repo list)');

async function gh(path, token = TOKEN) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

// Window start = creation time of the last successful run, so a failed run is retried next time.
async function sinceTimestamp() {
  if (process.env.SINCE) return Date.parse(process.env.SINCE);
  if (THIS_REPO && process.env.GITHUB_TOKEN) {
    const runs = await gh(
      `/repos/${THIS_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?status=success&per_page=1`,
      process.env.GITHUB_TOKEN,
    );
    if (runs.workflow_runs?.[0]) return Date.parse(runs.workflow_runs[0].created_at);
  }
  return Date.now() - FALLBACK_MINUTES * 60_000;
}

const REVIEW_STATES = {
  APPROVED: { label: 'approved', emoji: '✅', color: 'Good' },
  CHANGES_REQUESTED: { label: 'requested changes on', emoji: '🔴', color: 'Attention' },
  COMMENTED: { label: 'commented on', emoji: '💬', color: 'Accent' },
};

async function collectEvents(repo, since) {
  const events = [];
  for (let page = 1; ; page++) {
    const prs = await gh(`/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=50&page=${page}`);
    const recent = prs.filter((p) => Date.parse(p.updated_at) > since);

    for (const pr of recent) {
      const base = { repo, pr };
      if (!pr.draft && Date.parse(pr.created_at) > since) {
        events.push({ ...base, emoji: '🆕', color: 'Accent', headline: `${pr.user.login} opened a pull request` });
      }
      if (pr.merged_at && Date.parse(pr.merged_at) > since) {
        events.push({ ...base, emoji: '🎉', color: 'Good', headline: `${pr.merged_by?.login ?? pr.user.login} merged a pull request` });
      }
      const reviews = await gh(`/repos/${repo}/pulls/${pr.number}/reviews?per_page=100`);
      for (const r of reviews) {
        const state = REVIEW_STATES[r.state];
        if (!state || !r.user || Date.parse(r.submitted_at) <= since) continue;
        if (r.user.login === pr.user.login) continue;
        // Inline-comment reviews arrive as empty COMMENTED reviews; skip that noise.
        if (r.state === 'COMMENTED' && !r.body?.trim()) continue;
        events.push({
          ...base,
          emoji: state.emoji,
          color: state.color,
          headline: `${r.user.login} ${state.label} a pull request`,
          detail: r.body?.trim().slice(0, 300),
        });
      }
    }
    if (recent.length < prs.length || prs.length < 50) return events;
  }
}

function card({ repo, pr, emoji, color, headline, detail }) {
  const body = [
    text(`${emoji} ${escapeMd(headline)}`, { weight: 'Bolder', color }),
    text(`**[#${pr.number} ${escapeMd(pr.title)}](${pr.html_url})**`, { size: 'Medium' }),
    text(`${repo} · by ${pr.user.login} · \`${pr.head.ref}\` → \`${pr.base.ref}\``, { isSubtle: true, spacing: 'None' }),
  ];
  if (detail) body.push(text(escapeMd(detail)));
  return adaptiveCard(body, [openUrl('Open PR', pr.html_url)]);
}

const since = await sinceTimestamp();
console.log(`Checking ${REPOS.join(', ')} since ${new Date(since).toISOString()}`);

const events = (await Promise.all(REPOS.map((repo) => collectEvents(repo, since)))).flat();
for (const e of events) {
  await postCard(process.env.TEAMS_WEBHOOK_URL, card(e));
  console.log(`Notified: ${e.headline} (${e.repo}#${e.pr.number})`);
}
if (events.length === 0) console.log('Nothing new.');
