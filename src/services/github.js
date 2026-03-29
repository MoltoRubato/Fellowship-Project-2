const { Octokit } = require('@octokit/rest');

/**
 * Validate a PAT and return the authenticated user's GitHub username.
 */
async function validateTokenAndGetUser(token) {
  const octokit = new Octokit({ auth: token });
  try {
    const { data } = await octokit.rest.users.getAuthenticated();
    return { valid: true, username: data.login };
  } catch {
    return { valid: false };
  }
}

/**
 * Fetch commits and PRs for `username` since `since` (Date).
 * Returns an array of plain objects ready to be saved as log_entries.
 */
async function getRecentActivity(token, username, since) {
  const octokit = new Octokit({ auth: token });
  const results = [];

  try {
    const { data: events } = await octokit.rest.activity.listEventsForAuthenticatedUser({
      username,
      per_page: 100,
    });

    for (const event of events) {
      const eventDate = new Date(event.created_at);
      if (eventDate < since) continue;

      if (event.type === 'PushEvent') {
        for (const commit of event.payload.commits || []) {
          // Skip merge commits
          if (commit.message.startsWith('Merge')) continue;
          results.push({
            type: 'commit',
            repo: event.repo.name,
            message: commit.message.split('\n')[0], // first line only
            date: event.created_at,
          });
        }
      } else if (event.type === 'PullRequestEvent') {
        const pr = event.payload.pull_request;
        results.push({
          type: 'pr',
          action: event.payload.action,   // opened / closed / merged
          repo: event.repo.name,
          title: pr.title,
          date: event.created_at,
        });
      }
    }
  } catch (err) {
    console.error('[GitHub] Fetch error:', err.message);
  }

  return results;
}

module.exports = { validateTokenAndGetUser, getRecentActivity };