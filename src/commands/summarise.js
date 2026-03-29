const db = require('../services/db');
const llm = require('../services/llm');
const githubService = require('../services/github');
const { decrypt } = require('../utils/crypto');

/** Start of today (midnight UTC). */
function startOfToday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Start of the current ISO week (Monday midnight UTC). */
function startOfThisWeek() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day; // roll back to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

/**
 * Sync any new GitHub activity into log_entries so the summary is up to date.
 * Silent — errors are logged but don't block the summary.
 */
async function syncGithubIfConnected(user, since) {
  if (!user?.github_token || !user?.github_username) return;
  try {
    const token = decrypt(user.github_token);
    const activity = await githubService.getRecentActivity(token, user.github_username, since);
    const existing = await db.getLogEntries(user.slack_user_id, since);

    for (const item of activity) {
      const content =
        item.type === 'commit'
          ? `Commit to ${item.repo}: ${item.message}`
          : `PR ${item.action} in ${item.repo}: ${item.title}`;

      const alreadySaved = existing.some(e => e.content === content);
      if (!alreadySaved) {
        const source = item.type === 'commit' ? 'github_commit' : 'github_pr';
        await db.saveLogEntry(user.slack_user_id, content, 'update', source);
      }
    }
  } catch (err) {
    console.error('[/summarise] GitHub sync failed:', err.message);
  }
}

async function handleSummarise({ command, ack, respond, client }) {
  await ack();
  await respond({ text: '⏳ Generating your summary…', response_type: 'ephemeral' });

  const arg = command.text?.trim().toLowerCase();
  const isWeek = arg === 'week';
  const since = isWeek ? startOfThisWeek() : startOfToday();
  const periodLabel = isWeek ? 'this week' : 'today';

  await db.upsertUser(command.user_id, command.team_id);
  const user = await db.getUser(command.user_id);

  await syncGithubIfConnected(user, since);

  const entries = await db.getLogEntries(command.user_id, since);

  if (entries.length === 0) {
    await respond({
      text: `No entries found for ${periodLabel}. Use \`/did\`, \`/blocker\`, or \`/ooo\` to log updates first.`,
      response_type: 'ephemeral',
    });
    return;
  }

  // Resolve display name
  let userName = command.user_name;
  try {
    const info = await client.users.info({ user: command.user_id });
    userName = info.user?.real_name || command.user_name;
  } catch (_) {}

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const body = await llm.generateSummary(entries, userName, periodLabel);

  const header = `📋 *Standup Summary — ${userName} | ${dateStr}*\n\n`;
  const footer = `\n\n_Generated ${dateStr} at ${timeStr} · \`/summarise week\` for weekly view_`;

  // Post as a regular (non-ephemeral) message so the engineer can copy it
  await respond({
    text: header + body + footer,
    response_type: 'in_channel',
  });
}

module.exports = { handleSummarise };