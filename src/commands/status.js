const db = require('../services/db');

async function handleStatus({ command, ack, respond }) {
  await ack();

  const text = command.text?.trim();
  if (!text) {
    await respond({
      text: '❌ Please provide a status or availability note.\n*Usage:* `/ooo out tomorrow afternoon` · `/ooo back at 3pm`',
      response_type: 'ephemeral',
    });
    return;
  }

  await db.upsertUser(command.user_id, command.team_id);
  await db.saveLogEntry(command.user_id, text, 'status', 'manual');

  await respond({
    text: `📌 Status logged: _"${text}"_`,
    response_type: 'ephemeral',
  });
}

module.exports = { handleStatus };