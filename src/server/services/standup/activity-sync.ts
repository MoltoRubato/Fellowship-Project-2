import { EntrySource, EntryType } from "@prisma/client";
import { db } from "@/server/db";
import { fetchGithubActivity } from "@/server/services/integrations/github";
import { fetchLinearActivity } from "@/server/services/integrations/linear";
import { normalizeRepos } from "./repo";
import { createLogEntryForUser } from "./entries";
import type { UserContext } from "./types";

export async function syncConnectedActivity(
  user: UserContext,
  since: Date,
  repos?: string | string[] | null,
) {
  let githubCount = 0;
  let linearCount = 0;
  const normalizedRepos = normalizeRepos(Array.isArray(repos) ? repos : [repos]);
  const repoFilter = normalizedRepos.length ? normalizedRepos : null;

  const githubAccount = user.accounts.find((account) => account.provider === "github");
  if (githubAccount) {
    const activity = await fetchGithubActivity(githubAccount, since, repoFilter);
    for (const item of activity) {
      const entry = await createLogEntryForUser({ id: user.id, slackUserId: user.slackUserId }, {
        repo: item.repo,
        content: item.content,
        title: item.title,
        entryType: EntryType.update,
        source: item.source === "github_commit" ? EntrySource.github_commit : EntrySource.github_pr,
        externalId: item.externalId,
        externalUrl: item.externalUrl,
        createdAt: item.createdAt,
      });

      if (entry.externalId === item.externalId) {
        githubCount += 1;
      }
    }
  }

  const linearAccount = user.accounts.find((account) => account.provider === "linear");
  if (linearAccount) {
    const projectMappings = user.projects
      .filter((project) => project.linearProjectId && (!repoFilter || repoFilter.includes(project.githubRepo)))
      .map((project) => ({
        githubRepo: project.githubRepo,
        linearProjectId: project.linearProjectId!,
      }));

    const activity = await fetchLinearActivity(linearAccount, since, projectMappings, repoFilter);
    for (const item of activity) {
      const entry = await createLogEntryForUser({ id: user.id, slackUserId: user.slackUserId }, {
        repo: item.repo,
        content: item.content,
        title: item.title,
        entryType: EntryType.update,
        source: EntrySource.linear_issue,
        externalId: item.externalId,
        externalUrl: item.externalUrl,
        createdAt: item.createdAt,
      });

      if (entry.externalId === item.externalId) {
        linearCount += 1;
      }
    }
  }

  return { githubCount, linearCount };
}
