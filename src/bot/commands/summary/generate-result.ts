import type { SummaryPeriod } from "../types.js";
import type { SummaryAnswer } from "@/server/services/summary";
import {
  generateStandupSummary,
  getSummarySyncSince,
} from "@/server/services/summary";
import {
  reserveNextSummaryUpdateNo,
} from "@/server/services/summarySessions";
import {
  ensureSlackUser,
  getUserContextBySlackId,
  listActiveBlockers,
  listEntriesForSummaryPeriod,
  syncConnectedActivity,
} from "@/server/services/standup";

export async function generateSummaryResult(input: {
  slackUserId: string;
  slackTeamId: string;
  period: SummaryPeriod;
  repos?: string[] | null;
  updateNo?: number;
  answers?: SummaryAnswer[];
  skipSync?: boolean;
}) {
  await ensureSlackUser(input.slackUserId, input.slackTeamId);
  const since = getSummarySyncSince(input.period);
  const user = await getUserContextBySlackId(input.slackUserId);

  if (!user) {
    return {
      ok: false as const,
      text: "I couldn't find your profile yet. Run `/auth` and try again.",
    };
  }

  if (!input.skipSync) {
    try {
      await syncConnectedActivity(user, since);
    } catch (error) {
      console.error("Activity sync failed", error);
    }
  }

  const scopedRepos = input.repos?.length ? input.repos : null;
  const entries = await listEntriesForSummaryPeriod(input.slackUserId, input.period, scopedRepos);
  const blockers = await listActiveBlockers(input.slackUserId, scopedRepos);

  if (!entries.length && !blockers.length) {
    return {
      ok: false as const,
      text: `No entries found for ${input.period === "week" ? "this week" : "today"}. Try \`/did\` or \`/blocker\` first.`,
    };
  }

  const projectId =
    scopedRepos?.length === 1
      ? user.projects.find((project) => project.githubRepo === scopedRepos[0])?.id ?? null
      : entries.length === 1
        ? entries[0]?.projectId ?? null
        : null;
  const reservedUpdate =
    input.updateNo === undefined
      ? await reserveNextSummaryUpdateNo({
          userId: user.id,
          slackUserId: input.slackUserId,
        })
      : null;
  const updateNo = input.updateNo ?? reservedUpdate?.updateNo ?? 1;
  const summaryResult = await generateStandupSummary({
    userId: user.id,
    period: input.period,
    updateNo,
    entries,
    blockers,
    answers: input.answers ?? [],
  });

  return {
    ok: true as const,
    userId: user.id,
    projectId,
    updateNo,
    updateDateKey: reservedUpdate?.updateDateKey ?? null,
    summaryResult,
  };
}
