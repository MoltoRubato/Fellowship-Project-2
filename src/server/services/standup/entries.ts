import { EntrySource } from "@prisma/client";
import { db } from "@/server/db";
import { getSlackDateKey } from "@/server/services/slack";
import type { SummaryPeriod } from "@/server/services/summary";
import { getSummaryPeriodDateScope } from "@/server/services/summary/period-scope";
import { normalizeRepo, normalizeRepos } from "./repo";
import type { LoggedEntryInput } from "./types";
import { resolveProjectForUser, touchProject } from "./projects";
import { ensureSlackUser, getUserContextBySlackId } from "./users";
import {
  reserveNextImportedLogDisplayIdTx,
  reserveNextLogDisplayIdTx,
  realignNextLogDisplayIdTx,
} from "./log-display-ids";

async function getCurrentSlackDateKey(slackUserId: string) {
  return getSlackDateKey(slackUserId, new Date());
}

function isUserVisibleEntrySource(source: EntrySource) {
  return source === EntrySource.manual || source === EntrySource.dm;
}

export async function createLogEntryForUser(
  user: { id: string; slackUserId: string },
  input: Omit<LoggedEntryInput, "slackUserId" | "slackTeamId">,
) {
  const project = await resolveProjectForUser(user.id, input.repo);
  const projectId = project?.id ?? null;
  const displayDateKey = await getSlackDateKey(user.slackUserId, input.createdAt ?? new Date());
  const source = input.source ?? EntrySource.manual;
  const entry = await db.$transaction(async (tx) => {
    if (input.externalId) {
      const existing = await tx.logEntry.findFirst({
        where: {
          userId: user.id,
          projectId,
          source,
          externalId: input.externalId,
        },
      });

      if (existing) {
        return existing;
      }
    }

    const displayId = isUserVisibleEntrySource(source)
      ? await reserveNextLogDisplayIdTx(tx, user.id, displayDateKey)
      : await reserveNextImportedLogDisplayIdTx(tx, user.id, displayDateKey);

    return tx.logEntry.create({
      data: {
        userId: user.id,
        displayId,
        displayDateKey,
        projectId,
        content: input.content,
        entryType: input.entryType,
        source,
        title: input.title ?? null,
        externalId: input.externalId ?? null,
        externalUrl: input.externalUrl ?? null,
        metadata: input.metadata,
        createdAt: input.createdAt,
      },
    });
  });

  if (project?.id) {
    await touchProject(project.id);
  }

  return entry;
}

export async function logEntry(input: LoggedEntryInput) {
  const { user } = await ensureSlackUser(input.slackUserId, input.slackTeamId);

  return createLogEntryForUser({ id: user.id, slackUserId: user.slackUserId }, input);
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

export async function listEntriesForSummaryPeriod(
  slackUserId: string,
  period: SummaryPeriod,
  repo?: string | string[] | null,
) {
  const user = await getUserContextBySlackId(slackUserId);
  if (!user) {
    return [];
  }

  const { startDateKey } = await getSummaryPeriodDateScope(slackUserId, period);
  const normalizedRepos = Array.isArray(repo) ? normalizeRepos(repo) : normalizeRepos([repo]);

  return db.logEntry.findMany({
    where: {
      userId: user.id,
      deletedAt: null,
      displayDateKey: period === "today" ? startDateKey : { gte: startDateKey },
      ...(normalizedRepos.length
        ? {
            project: {
              githubRepo: { in: normalizedRepos },
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

export async function listActiveBlockers(
  slackUserId: string,
  repo?: string | string[] | null,
) {
  const user = await getUserContextBySlackId(slackUserId);
  if (!user) {
    return [];
  }

  const normalizedRepos = Array.isArray(repo) ? normalizeRepos(repo) : normalizeRepos([repo]);

  return db.logEntry.findMany({
    where: {
      userId: user.id,
      entryType: "blocker",
      deletedAt: null,
      ...(normalizedRepos.length
        ? {
            project: {
              githubRepo: { in: normalizedRepos },
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

export async function editManualEntryById(slackUserId: string, entryId: string, content: string) {
  const user = await getUserContextBySlackId(slackUserId);
  if (!user) {
    return null;
  }
  const currentDateKey = await getCurrentSlackDateKey(slackUserId);

  const entry = await db.logEntry.findFirst({
    where: {
      userId: user.id,
      id: entryId,
      deletedAt: null,
      displayDateKey: currentDateKey,
      source: {
        in: [EntrySource.manual, EntrySource.dm],
      },
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

export async function deleteManualEntryById(slackUserId: string, entryId: string) {
  const user = await getUserContextBySlackId(slackUserId);
  if (!user) {
    return null;
  }
  const currentDateKey = await getCurrentSlackDateKey(slackUserId);

  return db.$transaction(async (tx) => {
    const entry = await tx.logEntry.findFirst({
      where: {
        userId: user.id,
        id: entryId,
        deletedAt: null,
        displayDateKey: currentDateKey,
        source: {
          in: [EntrySource.manual, EntrySource.dm],
        },
      },
      include: {
        project: true,
      },
    });

    if (!entry) {
      return null;
    }

    const deletedEntry = await tx.logEntry.update({
      where: { id: entry.id },
      data: {
        deletedAt: new Date(),
      },
      include: {
        project: true,
      },
    });

    await realignNextLogDisplayIdTx(tx, {
      userId: user.id,
      dateKey: currentDateKey,
    });

    return {
      ...deletedEntry,
      displayId: entry.displayId,
    };
  });
}

export async function getLastSelfActionedRepo(slackUserId: string) {
  const user = await getUserContextBySlackId(slackUserId);
  if (!user) {
    return null;
  }

  const entry = await db.logEntry.findFirst({
    where: {
      userId: user.id,
      deletedAt: null,
      source: {
        in: [EntrySource.manual, EntrySource.dm, EntrySource.github_commit],
      },
      projectId: { not: null },
    },
    include: { project: true },
    orderBy: { createdAt: "desc" },
  });

  return entry?.project?.githubRepo ?? null;
}

export async function listRecentManualEntries(slackUserId: string, limit = 10) {
  const user = await getUserContextBySlackId(slackUserId);
  if (!user) {
    return [];
  }
  const currentDateKey = await getCurrentSlackDateKey(slackUserId);

  return db.logEntry.findMany({
    where: {
      userId: user.id,
      deletedAt: null,
      displayDateKey: currentDateKey,
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
