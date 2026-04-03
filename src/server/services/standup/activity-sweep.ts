import { getSummarySyncSince } from "@/server/services/summary";
import { listActiveSlackUsers } from "./users";
import { syncConnectedActivity } from "./activity-sync";

export async function runActivitySyncSweep(input?: {
  since?: Date;
}) {
  const since = input?.since ?? getSummarySyncSince("today");
  const users = await listActiveSlackUsers();
  let syncedUsers = 0;
  let githubCount = 0;
  let linearCount = 0;
  const failedUsers: string[] = [];

  for (const user of users) {
    try {
      const result = await syncConnectedActivity(user, since);
      syncedUsers += 1;
      githubCount += result.githubCount;
      linearCount += result.linearCount;
    } catch (error) {
      failedUsers.push(user.slackUserId);
      console.error("Scheduled sync failed", user.slackUserId, error);
    }
  }

  return {
    since: since.toISOString(),
    usersSeen: users.length,
    syncedUsers,
    githubCount,
    linearCount,
    failedUsers,
  };
}
