import type { SummaryPeriod } from "../types.js";
import {
  sortRepoNamesForRepoPicker,
} from "../shared/index.js";
import {
  getSummaryWindow,
} from "@/server/services/summary";
import {
  listEntriesSince,
  type UserContext,
} from "@/server/services/standup";

export async function determineSummaryRepoSelection(
  slackUserId: string,
  period: SummaryPeriod,
  user?: UserContext | null,
) {
  const since = getSummaryWindow(period);
  const entries = await listEntriesSince(slackUserId, since);
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
