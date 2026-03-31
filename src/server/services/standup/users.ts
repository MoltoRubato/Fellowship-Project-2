import { db } from "@/server/db";
import { USER_CONTEXT_INCLUDE } from "./types";

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
    include: USER_CONTEXT_INCLUDE,
  });
}

export async function getUserContextById(userId: string) {
  return db.user.findUnique({
    where: { id: userId },
    include: USER_CONTEXT_INCLUDE,
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
        orderBy: [{ lastUsedAt: "desc" as const }, { updatedAt: "desc" as const }],
      },
    },
  });
}
