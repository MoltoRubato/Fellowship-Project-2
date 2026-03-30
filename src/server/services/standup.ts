import { EntrySource, EntryType, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { fetchGithubActivity } from "@/server/services/github";
import { fetchLinearActivity } from "@/server/services/linear";

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export type UserContext = Prisma.UserGetPayload<{
  include: {
    accounts: true;
    projects: {
      include: { integrations: true };
      orderBy: [{ lastUsedAt: "desc" }, { githubRepoUpdatedAt: "desc" }, { updatedAt: "desc" }];
    };
  };
}>;

export interface LoggedEntryInput {
  slackUserId: string;
  slackTeamId: string;
  repo?: string | null;
  content: string;
  entryType: EntryType;
  source?: EntrySource;
  title?: string | null;
  externalId?: string | null;
  externalUrl?: string | null;
  metadata?: Prisma.InputJsonValue;
  createdAt?: Date;
}

export function isRepoLike(value?: string | null) {
  return Boolean(value && REPO_PATTERN.test(value.trim()));
}

export function normalizeRepo(value?: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\/+$/, "");
  return isRepoLike(normalized) ? normalized.toLowerCase() : null;
}

export async function ensureSlackUser(slackUserId: string, slackTeamId: string) {
  const existing = await db.user.findUnique({
    where: { slackUserId },
  });

  if (existing) {
    const user = await db.user.update({
      where: { id: existing.id },
      data: { slackTeamId },
    });

    return { user, created: false };
  }

  const user = await db.user.create({
    data: {
      slackUserId,
      slackTeamId,
    },
  });

  return { user, created: true };
}

export async function getUserContextBySlackId(slackUserId: string) {
  return db.user.findUnique({
    where: { slackUserId },
    include: {
      accounts: true,
      projects: {
        include: { integrations: true },
        orderBy: [{ lastUsedAt: "desc" }, { githubRepoUpdatedAt: "desc" }, { updatedAt: "desc" }],
      },
    },
  });
}

export async function getUserContextById(userId: string) {
  return db.user.findUnique({
    where: { id: userId },
    include: {
      accounts: true,
      projects: {
        include: { integrations: true },
        orderBy: [{ lastUsedAt: "desc" }, { githubRepoUpdatedAt: "desc" }, { updatedAt: "desc" }],
      },
    },
  });
}

async function resolveProjectForUser(userId: string, repo?: string | null) {
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

async function touchProject(projectId?: string | null) {
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

  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      projects: {
        orderBy: [{ githubRepoUpdatedAt: "desc" }, { githubRepo: "asc" }],
      },
    },
  });

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

  if (!input.externalId) {
    await db.projectIntegration.deleteMany({
      where: { projectId: input.projectId, type: input.type },
    });
    return project;
  }

  return db.projectIntegration.upsert({
    where: {
      projectId_type: {
        projectId: input.projectId,
        type: input.type,
      },
    },
    create: {
      projectId: input.projectId,
      type: input.type,
      externalId: input.externalId,
      externalTeamId: input.externalTeamId ?? null,
      externalName: input.externalName ?? null,
    },
    update: {
      externalId: input.externalId,
      externalTeamId: input.externalTeamId ?? null,
      externalName: input.externalName ?? null,
    },
  });
}

async function createLogEntryForUser(
  userId: string,
  input: Omit<LoggedEntryInput, "slackUserId" | "slackTeamId">,
) {
  const project = await resolveProjectForUser(userId, input.repo);

  if (input.externalId) {
    const existing = await db.logEntry.findFirst({
      where: {
        userId,
        source: input.source ?? EntrySource.manual,
        externalId: input.externalId,
      },
    });

    if (existing) {
      return existing;
    }
  }

  const entry = await db.logEntry.create({
    data: {
      userId,
      projectId: project?.id ?? null,
      content: input.content,
      entryType: input.entryType,
      source: input.source ?? EntrySource.manual,
      title: input.title ?? null,
      externalId: input.externalId ?? null,
      externalUrl: input.externalUrl ?? null,
      metadata: input.metadata,
      createdAt: input.createdAt,
    },
  });

  if (project?.id) {
    await touchProject(project.id);
  }

  return entry;
}

export async function logEntry(input: LoggedEntryInput) {
  const { user } = await ensureSlackUser(input.slackUserId, input.slackTeamId);

  return createLogEntryForUser(user.id, input);
}

export async function getProjectDisplayForUser(userId: string, repo?: string | null) {
  return resolveProjectForUser(userId, repo);
}

export async function listEntriesSince(
  slackUserId: string,
  since: Date,
  repo?: string | null,
) {
  const user = await getUserContextBySlackId(slackUserId);
  if (!user) {
    return [];
  }

  const normalizedRepo = normalizeRepo(repo);

  return db.logEntry.findMany({
    where: {
      userId: user.id,
      deletedAt: null,
      createdAt: { gte: since },
      ...(normalizedRepo
        ? {
            project: {
              githubRepo: normalizedRepo,
            },
          }
        : {}),
    },
    include: {
      project: true,
    },
    orderBy: [{ createdAt: "asc" }, { displayId: "asc" }],
  });
}

export async function listActiveBlockers(slackUserId: string, repo?: string | null) {
  const user = await getUserContextBySlackId(slackUserId);
  if (!user) {
    return [];
  }

  const normalizedRepo = normalizeRepo(repo);

  return db.logEntry.findMany({
    where: {
      userId: user.id,
      entryType: EntryType.blocker,
      deletedAt: null,
      ...(normalizedRepo
        ? {
            project: {
              githubRepo: normalizedRepo,
            },
          }
        : {}),
    },
    include: {
      project: true,
    },
    orderBy: [{ createdAt: "asc" }, { displayId: "asc" }],
  });
}

export async function editManualEntry(
  slackUserId: string,
  displayId: number,
  content: string,
  repo?: string | null,
) {
  const user = await getUserContextBySlackId(slackUserId);
  if (!user) {
    return null;
  }

  const normalizedRepo = normalizeRepo(repo);

  const entry = await db.logEntry.findFirst({
    where: {
      userId: user.id,
      displayId,
      deletedAt: null,
      source: {
        in: [EntrySource.manual, EntrySource.dm],
      },
      ...(normalizedRepo
        ? {
            project: {
              githubRepo: normalizedRepo,
            },
          }
        : {}),
    },
    include: {
      project: true,
    },
  });

  if (!entry) {
    return null;
  }

  return db.logEntry.update({
    where: { id: entry.id },
    data: {
      content,
    },
    include: {
      project: true,
    },
  });
}

export async function deleteManualEntry(slackUserId: string, displayId: number, repo?: string | null) {
  const user = await getUserContextBySlackId(slackUserId);
  if (!user) {
    return null;
  }

  const normalizedRepo = normalizeRepo(repo);

  const entry = await db.logEntry.findFirst({
    where: {
      userId: user.id,
      displayId,
      deletedAt: null,
      source: {
        in: [EntrySource.manual, EntrySource.dm],
      },
      ...(normalizedRepo
        ? {
            project: {
              githubRepo: normalizedRepo,
            },
          }
        : {}),
    },
    include: {
      project: true,
    },
  });

  if (!entry) {
    return null;
  }

  return db.logEntry.update({
    where: { id: entry.id },
    data: {
      deletedAt: new Date(),
    },
    include: {
      project: true,
    },
  });
}

export async function listRecentManualEntries(slackUserId: string, limit = 10) {
  const user = await getUserContextBySlackId(slackUserId);
  if (!user) {
    return [];
  }

  return db.logEntry.findMany({
    where: {
      userId: user.id,
      deletedAt: null,
      source: {
        in: [EntrySource.manual, EntrySource.dm],
      },
    },
    include: {
      project: true,
    },
    orderBy: [{ createdAt: "desc" }, { displayId: "desc" }],
    take: limit,
  });
}

export async function listActiveSlackUsers() {
  return db.user.findMany({
    where: {
      logEntries: {
        some: {
          deletedAt: null,
        },
      },
    },
    include: {
      accounts: true,
      projects: {
        include: { integrations: true },
        orderBy: [{ lastUsedAt: "desc" }, { updatedAt: "desc" }],
      },
    },
  });
}

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
    const linearIntegrations = await db.projectIntegration.findMany({
      where: {
        projectId: { in: user.projects.map((p) => p.id) },
        type: "linear",
        externalId: { not: null },
      },
      include: { project: true },
    });

    const projectMappings = linearIntegrations
      .filter((i) => i.externalId !== null)
      .map((i) => ({
        githubRepo: i.project.githubRepo,
        linearProjectId: i.externalId!,
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
