import type { SummaryPeriod } from "../types";
import {
  sortRepoNamesForRepoPicker,
} from "../shared";
import {
  listEntriesForSummaryPeriod,
  type UserContext,
} from "@/server/services/standup";

export async function determineSummaryRepoSelection(
  slackUserId: string,
  period: SummaryPeriod,
  user?: UserContext | null,
) {
  const entries = await listEntriesForSummaryPeriod(slackUserId, period);
  const repos = [...new Set(entries.map((entry) => entry.project?.githubRepo ?? null))];
  const scopedRepos = repos.filter((repo): repo is string => Boolean(repo));
  const hasUnscopedEntries = repos.includes(null);

  if (scopedRepos.length > 1) {
    return {
      type: "modal" as const,
      repoNames: sortRepoNamesForRepoPicker(scopedRepos, user),
    };
  }

  if (scopedRepos.length === 1 && !hasUnscopedEntries) {
    return {
      type: "single" as const,
      repo: scopedRepos[0],
    };
  }

  return {
    type: "all" as const,
  };
}
