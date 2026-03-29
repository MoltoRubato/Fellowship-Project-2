const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

// ── Users ──────────────────────────────────────────────────────────────────────

async function upsertUser(slackUserId, slackTeamId) {
  const res = await query(
    `INSERT INTO users (slack_user_id, slack_team_id)
     VALUES ($1, $2)
     ON CONFLICT (slack_user_id) DO UPDATE SET slack_team_id = $2
     RETURNING *`,
    [slackUserId, slackTeamId]
  );
  return res.rows[0];
}

async function getUser(slackUserId) {
  const res = await query('SELECT * FROM users WHERE slack_user_id = $1', [slackUserId]);
  return res.rows[0] || null;
}

async function updateUserGithub(slackUserId, encryptedToken, githubUsername) {
  await query(
    `UPDATE users SET github_token = $2, github_username = $3 WHERE slack_user_id = $1`,
    [slackUserId, encryptedToken, githubUsername]
  );
}

/** Returns all users that have a connected GitHub account. */
async function getAllUsersWithGithub() {
  const res = await query(
    `SELECT * FROM users WHERE github_token IS NOT NULL AND github_username IS NOT NULL`
  );
  return res.rows;
}

/**
 * Returns all users that have logged at least one entry.
 * Used by the reminder job — we don't DM people who have never used the bot.
 */
async function getAllActiveUsers() {
  const res = await query(
    `SELECT DISTINCT u.*
     FROM users u
     INNER JOIN log_entries le ON u.slack_user_id = le.slack_user_id`
  );
  return res.rows;
}

async function updateLastGithubSync(slackUserId) {
  await query(
    `UPDATE users SET last_github_sync = NOW() WHERE slack_user_id = $1`,
    [slackUserId]
  );
}

// ── Log entries ────────────────────────────────────────────────────────────────

async function saveLogEntry(slackUserId, content, entryType, source = 'manual') {
  const res = await query(
    `INSERT INTO log_entries (slack_user_id, content, entry_type, source)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [slackUserId, content, entryType, source]
  );
  return res.rows[0];
}

/** Returns all entries for a user created on or after `since` (Date object). */
async function getLogEntries(slackUserId, since) {
  const res = await query(
    `SELECT * FROM log_entries
     WHERE slack_user_id = $1 AND created_at >= $2
     ORDER BY created_at ASC`,
    [slackUserId, since]
  );
  return res.rows;
}

module.exports = {
  upsertUser,
  getUser,
  updateUserGithub,
  getAllUsersWithGithub,
  getAllActiveUsers,
  updateLastGithubSync,
  saveLogEntry,
  getLogEntries,
};