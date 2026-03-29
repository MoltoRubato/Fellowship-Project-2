require('dotenv').config();

const { App } = require('@slack/bolt');
const { handleDid }        = require('./commands/did');
const { handleBlocker }    = require('./commands/blocker');
const { handleStatus }     = require('./commands/status');
const { handleSummarise }  = require('./commands/summarise');
const {
  handleGithubConnect,
  handleGithubSync,
  handleGithubTokenMessage,
  pendingTokenUsers,
} = require('./commands/github');
const db                       = require('./services/db');
const { startGithubSyncJob } = require('./jobs/githubSync');
const { startReminderJob }   = require('./jobs/reminders');

// ── App init ───────────────────────────────────────────────────────────────────

const app = new App({
  token:         process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode:    true,
  appToken:      process.env.SLACK_APP_TOKEN,
});

// ── Slash commands ─────────────────────────────────────────────────────────────

app.command('/did',       handleDid);
app.command('/blocker',   handleBlocker);
app.command('/ooo',       handleStatus);
app.command('/summarise', handleSummarise);

app.command('/github', async ({ command, ack, respond }) => {
  const sub = command.text?.trim().split(/\s+/)[0]?.toLowerCase();

  if (sub === 'connect') {
    await handleGithubConnect({ command, ack, respond });
  } else if (sub === 'sync') {
    await handleGithubSync({ command, ack, respond });
  } else {
    await ack();
    await respond({
      text: 'Available sub-commands: `/github connect` · `/github sync`',
      response_type: 'ephemeral',
    });
  }
});

// ── DM listener — GitHub token paste + general updates ──────────────────────

app.message(async ({ message, client }) => {
  if (message.channel_type !== 'im') return;
  if (!message.user) return;
  if (message.subtype) return; // ignore bot messages, edits, etc.

  // If the user is in the GitHub token flow, handle that first
  if (pendingTokenUsers.has(message.user)) {
    await handleGithubTokenMessage({ message, client });
    return;
  }

  // Otherwise treat the DM as a standup update
  const text = message.text?.trim();
  if (!text) return;

  try {
    // Look up the user's team ID (needed for upsert)
    const info = await client.users.info({ user: message.user });
    const teamId = info.user?.team_id || 'unknown';

    await db.upsertUser(message.user, teamId);
    await db.saveLogEntry(message.user, text, 'update', 'dm');

    await client.chat.postMessage({
      channel: message.user,
      text: `✅ Logged: _"${text}"_\n_Tip: use \`/did\`, \`/blocker\`, or \`/ooo\` for categorised entries._`,
    });
  } catch (err) {
    console.error('[DM handler] Error:', err.message);
    await client.chat.postMessage({
      channel: message.user,
      text: '❌ Something went wrong saving your update. Please try again.',
    });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────

(async () => {
  try {
    await app.start();
    console.log('⚡ Standup bot is running!');

    startGithubSyncJob();
    startReminderJob(app.client);
  } catch (err) {
    console.error('❌ Failed to start the bot:', err.message);
    if (err.message.includes('disconnect') || err.message.includes('socket')) {
      console.error(
        '\nHint: Make sure Socket Mode is enabled in your Slack app settings\n' +
        'and that SLACK_APP_TOKEN starts with "xapp-".'
      );
    }
    process.exit(1);
  }
})();