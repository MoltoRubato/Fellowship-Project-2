const db = require('../services/db');

async function handleDid({ command, ack, respond }) {
  await ack();

  const text = command.text?.trim();
  if (!text) {
    await respond({
      text: '❌ Please describe what you worked on.\n*Usage:* `/did implemented the auth flow`',
      response_type: 'ephemeral',
    });
    return;
  }

  await db.upsertUser(command.user_id, command.team_id);
  await db.saveLogEntry(command.user_id, text, 'update', 'manual');

  await respond({
    text: `✅ Logged: _"${text}"_`,
    response_type: 'ephemeral',
  });
}

module.exports = { handleDid };