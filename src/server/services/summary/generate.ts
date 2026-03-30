import type { SummaryLogEntry, SummaryPeriod, SummaryAnswer } from "./types";
import { fetchGithubCommitDetails } from "@/server/services/integrations/github";
import { parseCommitEntry, buildCommitPromptItems, buildTaskItems, buildBlockerItems } from "./task-processing";
import { runAiSummary } from "./ai";
import { buildFallbackSummary } from "./fallback";

export function getSummaryWindow(period: SummaryPeriod) {
  if (period === "week") {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    now.setDate(now.getDate() + diff);
    return now;
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

export async function generateStandupSummary(input: {
  userId: string;
  period: SummaryPeriod;
  updateNo: number;
  entries: SummaryLogEntry[];
  blockers: SummaryLogEntry[];
  answers?: SummaryAnswer[];
}) {
  const commitLookups = input.entries
    .map((entry) => parseCommitEntry(entry))
    .filter((entry): entry is NonNullable<ReturnType<typeof parseCommitEntry>> => Boolean(entry));
  const commitDetails = await fetchGithubCommitDetails(input.userId, commitLookups);
  const blockers = buildBlockerItems(input.blockers);
  const commits = buildCommitPromptItems(commitDetails);
  const tasks = buildTaskItems(input.entries);

  const aiResult = await runAiSummary({
    userId: input.userId,
    period: input.period,
    updateNo: input.updateNo,
    blockers,
    commits,
    tasks,
    commitDetails,
    answers: input.answers ?? [],
  });

  if (aiResult) {
    return aiResult;
  }

  return buildFallbackSummary({
    updateNo: input.updateNo,
    period: input.period,
    entries: input.entries,
    blockers: input.blockers,
  });
}
