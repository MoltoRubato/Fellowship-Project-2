const db = require('../services/db');

async function handleBlocker({ command, ack, respond }) {
  await ack();

  const text = command.text?.trim();
  if (!text) {
    await respond({
      text: '❌ Please describe the blocker.\n*Usage:* `/blocker waiting on AWS access from DevOps`',
      response_type: 'ephemeral',
    });
    return;
  }

  await db.upsertUser(command.user_id, command.team_id);
  await db.saveLogEntry(command.user_id, text, 'blocker', 'manual');

  await respond({
    text: `🚧 Blocker logged: _"${text}"_`,
    response_type: 'ephemeral',
  });
}

module.exports = { handleBlocker };