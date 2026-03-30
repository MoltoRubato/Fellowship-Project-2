import { EntrySource } from "@prisma/client";
import { db } from "@/server/db";
import { normalizeRepo } from "./repo";
import type { LoggedEntryInput } from "./types";
import { resolveProjectForUser, touchProject } from "./projects";
import { ensureSlackUser, getUserContextBySlackId } from "./users";

export async function createLogEntryForUser(
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
      entryType: "blocker",
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
