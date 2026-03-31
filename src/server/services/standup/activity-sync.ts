import { EntrySource, EntryType } from "@prisma/client";
import { db } from "@/server/db";
import { fetchGithubActivity } from "@/server/services/integrations/github";
import { fetchLinearActivity } from "@/server/services/integrations/linear";
import { normalizeRepo } from "./repo";
import { createLogEntryForUser } from "./entries";
import type { UserContext } from "./types";

export async function syncConnectedActivity(user: UserContext, since: Date, repo?: string | null) {
  let githubCount = 0;
  let linearCount = 0;
  const normalizedRepo = normalizeRepo(repo);

  const githubAccount = user.accounts.find((account) => account.provider === "github");
  if (githubAccount) {
    const activity = await fetchGithubActivity(githubAccount, since, normalizedRepo);
    for (const item of activity) {
      const entry = await createLogEntryForUser(user.id, {
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
      .filter((project) => project.linearProjectId)
      .map((project) => ({
        githubRepo: project.githubRepo,
        linearProjectId: project.linearProjectId!,
      }));

    const activity = await fetchLinearActivity(linearAccount, since, projectMappings, normalizedRepo);
    for (const item of activity) {
      const entry = await createLogEntryForUser(user.id, {
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
