import cron from "node-cron";
import { getSummarySyncSince } from "@/server/services/summary";
import { listActiveSlackUsers, syncConnectedActivity } from "@/server/services/standup";

export function startActivitySyncJob() {
  cron.schedule(
    "0 8,10,12,14,16,18 * * 1-5",
    async () => {
      const users = await listActiveSlackUsers();
      const since = getSummarySyncSince("today");

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
