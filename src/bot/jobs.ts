import cron from "node-cron";
import { runActivitySyncSweep } from "@/server/services/standup/activity-sweep";

export function startActivitySyncJob() {
  cron.schedule(
    "0 8,10,12,14,16,18 * * 1-5",
    async () => {
      await runActivitySyncSweep();
    },
    { timezone: "UTC" },
  );
}
