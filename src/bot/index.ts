import "dotenv/config";
import { App } from "@slack/bolt";
import {
  handleAuth,
  handleBlocker,
  handleDelete,
  handleDid,
  handleDirectMessage,
  handleEdit,
  handleSummarise,
} from "@/bot/commands";
import { startActivitySyncJob, startReminderJobs } from "@/bot/jobs";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

app.command("/did", handleDid);
app.command("/blocker", handleBlocker);
app.command("/edit", handleEdit);
app.command("/delete", handleDelete);
app.command("/summarise", handleSummarise);
app.command("/auth", handleAuth);

app.message(async ({ message }) => {
  if (
    message.channel_type !== "im" ||
    !("user" in message) ||
    !("text" in message) ||
    ("subtype" in message && Boolean(message.subtype)) ||
    !message.user ||
    typeof message.text !== "string" ||
    !message.text.trim()
  ) {
    return;
  }

  await handleDirectMessage(app, message.user, message.text.trim());
});

async function start() {
  await app.start();
  startReminderJobs(app);
  startActivitySyncJob();
  console.log("Standup Bot is running.");
}

start().catch((error) => {
  console.error("Failed to start Standup Bot", error);
  process.exit(1);
});
