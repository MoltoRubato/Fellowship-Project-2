const cron = require('node-cron');
const db = require('../services/db');
const githubService = require('../services/github');
const { decrypt } = require('../utils/crypto');

/**
 * Runs every 2 hours on weekdays (8am, 10am, 12pm, 2pm, 4pm, 6pm).
 * Pulls today's commits and PRs for every user with a connected GitHub account.
 */
function startGithubSyncJob() {
  cron.schedule('0 8,10,12,14,16,18 * * 1-5', async () => {
    console.log('[GitHub Sync] Starting scheduled sync…');

    const users = await db.getAllUsersWithGithub();
    if (users.length === 0) return;

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);

    for (const user of users) {
      try {
        const token = decrypt(user.github_token);
        const activity = await githubService.getRecentActivity(token, user.github_username, since);
        const existing = await db.getLogEntries(user.slack_user_id, since);

        let newCount = 0;
        for (const item of activity) {
          const content =
            item.type === 'commit'
              ? `Commit to ${item.repo}: ${item.message}`
              : `PR ${item.action} in ${item.repo}: ${item.title}`;

          const alreadySaved = existing.some(e => e.content === content);
          if (!alreadySaved) {
            const source = item.type === 'commit' ? 'github_commit' : 'github_pr';
            await db.saveLogEntry(user.slack_user_id, content, 'update', source);
            newCount++;
          }
        }

        await db.updateLastGithubSync(user.slack_user_id);
        console.log(`[GitHub Sync] @${user.github_username}: +${newCount} new events`);
      } catch (err) {
        console.error(`[GitHub Sync] Failed for ${user.slack_user_id}:`, err.message);
      }
    }

    console.log('[GitHub Sync] Done.');
  });
}

module.exports = { startGithubSyncJob };