import "dotenv/config";
import { App } from "@slack/bolt";
import { registerAllCommands } from "@/bot/commands";
import { startActivitySyncJob, startReminderJobs } from "@/bot/jobs";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

registerAllCommands(app);

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
