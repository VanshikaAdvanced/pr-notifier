# teams-pr-notifier

Watches one or more GitHub repos from a separate repo and posts to a Microsoft Teams chat or channel. No server and no dependencies: GitHub Actions runs small Node scripts. Nothing is added to the watched repos.

## What you get

- **PR alerts** (checked every ~10 minutes, weekdays 07:00-16:50 UTC; the first run of each day catches up on anything since the last run): PR opened, merged, approved, changes requested, or commented on with text. Drafts stay quiet until they are ready.
- **Daily digest** (weekday mornings): open PRs, drafts, awaiting review, changes requested, approved and ready to merge, stale PRs, the oldest open PR, plus lists of the stalest PRs and those waiting longest for review.

## Setup

1. **Teams webhook.** Create a Power Automate flow with trigger "When a Teams webhook request is received" and action "Post card in a chat or channel", with the Adaptive Card set to the expression `triggerBody()?['attachments']?[0]?['content']`. Copy the HTTP POST URL.
2. **Create a new GitHub repo** (private is fine) and push this folder to it.
3. **Create a token that can read the watched repos.** Use a fine-grained PAT with access to the repos and read-only **Pull requests** and **Metadata** permissions. If the org requires it, authorize it for SSO.
4. **In the notifier repo**, go to Settings > Secrets and variables > Actions and add:
   - Secrets: `TEAMS_WEBHOOK_URL`, `GH_PAT`
   - Variable: `REPOS`, such as `advancedcsg/oneadvanced-web` (comma-separated for several)
   - Optional variable: `STALE_DAYS` (default 5)
5. **Test.** In the Actions tab, run **Daily PR digest** and **PR alerts to Teams** manually.

## Notes

- Scheduled workflows only run from the default branch, and GitHub can delay them by several minutes. They are paused after 60 days with no repo activity.
- Private repos on a free GitHub account get 2,000 Actions minutes a month. The alerts schedule uses about 1,300 and the digest about 22; widening the hours or shortening the interval can exceed the limit and block all workflows until the month resets.
- The digest time is the `cron` line in `daily-digest.yml`. It is in UTC.
- Alerts cover everything since the last successful run. After a failed run, the next one catches up.
- Run locally to test the digest: `TEAMS_WEBHOOK_URL=... GITHUB_TOKEN=... REPOS=owner/repo node src/daily-digest.js`
