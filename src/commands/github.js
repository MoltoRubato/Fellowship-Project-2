const db = require('../services/db');
const githubService = require('../services/github');
const { encrypt, decrypt } = require('../utils/crypto');

/**
 * In-memory set of user IDs currently in the token-paste flow.
 * Exported so app.js can pass incoming DMs to handleGithubTokenMessage.
 */
const pendingTokenUsers = new Set();

// ── /github connect ────────────────────────────────────────────────────────────

async function handleGithubConnect({ command, ack, respond }) {
  await ack();

  await db.upsertUser(command.user_id, command.team_id);
  pendingTokenUsers.add(command.user_id);

  await respond({
    text:
      `🔐 *GitHub Integration Setup*\n\n` +
      `1. Go to https://github.com/settings/tokens and create a *Classic* Personal Access Token.\n` +
      `2. Required scopes: \`repo\` (read) and \`read:user\`\n` +
      `3. *Open a DM with this bot* and paste the token as your next message.\n\n` +
      `⚠️ *Delete that DM message immediately after sending it* to keep it out of your chat history.`,
    response_type: 'ephemeral',
  });
}

// ── /github sync ───────────────────────────────────────────────────────────────

async function handleGithubSync({ command, ack, respond }) {
  await ack();
  await respond({ text: '🔄 Syncing GitHub activity…', response_type: 'ephemeral' });

  const user = await db.getUser(command.user_id);
  if (!user?.github_token) {
    await respond({
      text: '❌ No GitHub token connected. Use `/github connect` first.',
      response_type: 'ephemeral',
    });
    return;
  }

  const token = decrypt(user.github_token);
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);

  const activity = await githubService.getRecentActivity(token, user.github_username, since);
  const existing = await db.getLogEntries(command.user_id, since);

  let newCount = 0;
  for (const item of activity) {
    const content =
      item.type === 'commit'
        ? `Commit to ${item.repo}: ${item.message}`
        : `PR ${item.action} in ${item.repo}: ${item.title}`;

    const alreadySaved = existing.some(e => e.content === content);
    if (!alreadySaved) {
      const source = item.type === 'commit' ? 'github_commit' : 'github_pr';
      await db.saveLogEntry(command.user_id, content, 'update', source);
      newCount++;
    }
  }

  const skipped = activity.length - newCount;
  await respond({
    text:
      `✅ Synced *${newCount}* new GitHub event${newCount !== 1 ? 's' : ''}` +
      (skipped > 0 ? ` (${skipped} already logged).` : '.'),
    response_type: 'ephemeral',
  });
}

// ── DM token handler ───────────────────────────────────────────────────────────

async function handleGithubTokenMessage({ message, client }) {
  const userId = message.user;
  if (!pendingTokenUsers.has(userId)) return;
  pendingTokenUsers.delete(userId);

  const token = message.text?.trim();

  // Basic format check
  const looksValid =
    token &&
    (token.startsWith('ghp_') ||
      token.startsWith('github_pat_') ||
      /^[a-f0-9]{40}$/.test(token)); // legacy format

  if (!looksValid) {
    await client.chat.postMessage({
      channel: userId,
      text: `❌ That doesn't look like a valid GitHub token. Tokens usually start with \`ghp_\` or \`github_pat_\`.\nTry \`/github connect\` again.`,
    });
    return;
  }

  // Validate against the API
  const validation = await githubService.validateTokenAndGetUser(token);
  if (!validation.valid) {
    await client.chat.postMessage({
      channel: userId,
      text: `❌ GitHub rejected that token. Please check the scopes (\`repo\`, \`read:user\`) and try \`/github connect\` again.`,
    });
    return;
  }

  // Encrypt and persist
  const encryptedToken = encrypt(token);
  await db.updateUserGithub(userId, encryptedToken, validation.username);

  await client.chat.postMessage({
    channel: userId,
    text:
      `✅ GitHub connected as *@${validation.username}*!\n\n` +
      `⚠️ *Please delete the message where you pasted your token* to remove it from your chat history.\n\n` +
      `Your commits and PRs will be pulled automatically when you run \`/summarise\`. ` +
      `You can also sync manually with \`/github sync\`.`,
  });
}

module.exports = {
  handleGithubConnect,
  handleGithubSync,
  handleGithubTokenMessage,
  pendingTokenUsers,
};