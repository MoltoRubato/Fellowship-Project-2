import cron from "node-cron";
import type { App } from "@slack/bolt";
import { getSummaryWindow } from "@/server/services/summary";
import { listActiveSlackUsers, syncConnectedActivity } from "@/server/services/standup";

const REMINDERS = [
  {
    schedule: "0 9 * * 1-5",
    text: "Morning check-in: what are you working on today? Use `/did` to log your first update.",
  },
  {
    schedule: "0 17 * * 1-5",
    text: "End-of-day nudge: run `/summarise` when you're ready to paste your standup update.",
  },
];

export function startReminderJobs(app: App) {
  for (const reminder of REMINDERS) {
    cron.schedule(
      reminder.schedule,
      async () => {
        const users = await listActiveSlackUsers();

        for (const user of users) {
          try {
            await app.client.chat.postMessage({
              channel: user.slackUserId,
              text: reminder.text,
            });
          } catch (error) {
            console.error("Reminder failed", user.slackUserId, error);
          }
        }
      },
      { timezone: "UTC" },
    );
  }
}

export function startActivitySyncJob() {
  cron.schedule(
    "0 8,10,12,14,16,18 * * 1-5",
    async () => {
      const users = await listActiveSlackUsers();
      const since = getSummaryWindow("today");

      for (const user of users) {
        try {
          await syncConnectedActivity(user, since);
        } catch (error) {
          console.error("Scheduled sync failed", user.slackUserId, error);
        }
      }
    },
    { timezone: "UTC" },
  );
}
