const cron = require('node-cron');
const db = require('../services/db');

const REMINDERS = [
  {
    schedule: '0 9 * * 1-5',   // 9am Mon–Fri
    text: `👋 *Morning check-in!* What are you working on today?\nUse \`/did\` to log your first update.`,
  },
  {
    schedule: '0 14 * * 1-5',  // 2pm Mon–Fri
    text: `⏰ *Afternoon nudge* — any updates or blockers since this morning?\nTry \`/did\` or \`/blocker\`.`,
  },
  {
    schedule: '0 17 * * 1-5',  // 5pm Mon–Fri
    text: `🌆 *End of day!* Time to wrap up.\nRun \`/summarise\` to get your standup summary ready for tomorrow.`,
  },
];

/**
 * @param {import('@slack/bolt').App['client']} slackClient
 */
function startReminderJob(slackClient) {
  for (const { schedule, text } of REMINDERS) {
    cron.schedule(schedule, async () => {
      console.log(`[Reminders] Sending: "${text.slice(0, 50).replace(/\n/g, ' ')}…"`);

      try {
        const users = await db.getAllActiveUsers();
        for (const user of users) {
          try {
            await slackClient.chat.postMessage({
              channel: user.slack_user_id, // posting to a user ID sends a DM
              text,
            });
          } catch (err) {
            console.error(`[Reminders] Failed to DM ${user.slack_user_id}:`, err.message);
          }
        }
      } catch (err) {
        console.error('[Reminders] Job error:', err.message);
      }
    });
  }
}

module.exports = { startReminderJob };