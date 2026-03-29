const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Generate a standup summary from an array of log_entries rows.
 * @param {Array}  entries     - rows from log_entries table
 * @param {string} userName    - display name of the engineer
 * @param {string} periodLabel - e.g. "today" or "this week"
 */
async function generateSummary(entries, userName, periodLabel = 'today') {
  const manualUpdates  = entries.filter(e => e.entry_type === 'update' && e.source === 'manual');
  const githubUpdates  = entries.filter(e => e.source === 'github_commit' || e.source === 'github_pr');
  const blockers       = entries.filter(e => e.entry_type === 'blocker');
  const statusUpdates  = entries.filter(e => e.entry_type === 'status');

  const prompt = `You are a helpful assistant that writes clear, concise engineering standup summaries.

Here are the raw log entries from ${userName} for ${periodLabel}:

MANUAL WORK UPDATES:
${manualUpdates.map(e => `- ${e.content}`).join('\n') || '- (none)'}

GITHUB ACTIVITY:
${githubUpdates.map(e => `- ${e.content}`).join('\n') || '- (none)'}

BLOCKERS:
${blockers.map(e => `- ${e.content}`).join('\n') || '- (none)'}

STATUS / MISC:
${statusUpdates.map(e => `- ${e.content}`).join('\n') || '- (none)'}

Write a standup summary using EXACTLY this format. Use Slack markdown (*bold*, bullet •).
Do not add any preamble or closing remarks — output only the four sections below:

*What I worked on:*
• [concise bullet per task; group related items; one line each]

*In progress:*
• [anything that appears ongoing or unfinished — write "Nothing ongoing" if none]

*Blockers:*
🚧 [each blocker on its own line — write "None" if no blockers]

*GitHub activity:*
• [each commit/PR on its own line — write "None" if no github activity]`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content[0].text;
}

module.exports = { generateSummary };