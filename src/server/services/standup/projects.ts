import { db } from "@/server/db";
import { normalizeRepo } from "./repo";

export async function resolveProjectForUser(userId: string, repo?: string | null) {
  const normalizedRepo = normalizeRepo(repo);
  if (normalizedRepo) {
    return db.project.upsert({
      where: {
        userId_githubRepo: {
          userId,
          githubRepo: normalizedRepo,
        },
      },
      create: {
        userId,
        githubRepo: normalizedRepo,
        githubRepoUrl: `https://github.com/${normalizedRepo}`,
        lastUsedAt: new Date(),
      },
      update: {
        githubRepoUrl: `https://github.com/${normalizedRepo}`,
        lastUsedAt: new Date(),
      },
    });
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      projects: {
        orderBy: [{ lastUsedAt: "desc" }, { githubRepoUpdatedAt: "desc" }, { updatedAt: "desc" }],
      },
    },
  });

  return user?.projects[0] ?? null;
}

export async function touchProject(projectId?: string | null) {
  if (!projectId) {
    return;
  }

  await db.project.update({
    where: { id: projectId },
    data: {
      lastUsedAt: new Date(),
    },
  });
}

export async function syncGithubProjects(
  userId: string,
  repos: Array<{
    id: string;
    nameWithOwner: string;
    url: string;
    updatedAt: string | null;
  }>,
) {
  for (const repo of repos) {
    await db.project.upsert({
      where: {
        userId_githubRepo: {
          userId,
          githubRepo: repo.nameWithOwner.toLowerCase(),
        },
      },
      create: {
        userId,
        githubRepo: repo.nameWithOwner.toLowerCase(),
        githubRepoId: repo.id,
        githubRepoUrl: repo.url,
        githubRepoUpdatedAt: repo.updatedAt ? new Date(repo.updatedAt) : null,
      },
      update: {
        githubRepoId: repo.id,
        githubRepoUrl: repo.url,
        githubRepoUpdatedAt: repo.updatedAt ? new Date(repo.updatedAt) : null,
      },
    });
  }

  return db.project.findMany({
    where: { userId },
    orderBy: [{ lastUsedAt: "desc" }, { githubRepoUpdatedAt: "desc" }, { githubRepo: "asc" }],
  });
}

export async function linkIntegration(
  userId: string,
  input: {
    projectId: string;
    type: "linear";
    externalId?: string | null;
    externalTeamId?: string | null;
    externalName?: string | null;
  },
) {
  const project = await db.project.findFirst({
    where: {
      id: input.projectId,
      userId,
    },
  });

  if (!project) {
    throw new Error("Project not found");
  }

  if (input.type !== "linear") {
    throw new Error("Unsupported integration type");
  }

  return db.project.update({
    where: { id: project.id },
    data: {
      linearProjectId: input.externalId ?? null,
      linearTeamId: input.externalTeamId ?? null,
      linearProjectName: input.externalName ?? null,
    },
  });
}
