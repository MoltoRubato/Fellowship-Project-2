import { Prisma, SummarySessionStatus } from "@prisma/client";
import { db } from "@/server/db";
import { reserveNextDailySummaryUpdateNoTx } from "@/server/services/daily-sequences";
import { getSlackDateKey } from "@/server/services/slack";

export interface SummarySessionQuestion {
  message: string;
  options: string[];
}

export interface SummarySessionAnswer {
  message: string;
  answer: string;
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function sessionExpiryDate() {
  return new Date(Date.now() + SESSION_TTL_MS);
}

export async function expirePendingSummarySessionsForUser(userId: string) {
  await db.summarySession.updateMany({
    where: {
      userId,
      status: SummarySessionStatus.pending,
    },
    data: {
      status: SummarySessionStatus.expired,
    },
  });
}

export async function reserveNextSummaryUpdateNo(input: {
  userId: string;
  slackUserId: string;
  date?: Date;
}) {
  const updateDateKey = await getSlackDateKey(input.slackUserId, input.date ?? new Date());

  return db.$transaction(async (tx) => {
    const updateNo = await reserveNextDailySummaryUpdateNoTx(tx, input.userId, updateDateKey);
    return { updateNo, updateDateKey };
  });
}

export async function createPendingSummarySession(input: {
  userId: string;
  projectId?: string | null;
  channelId: string;
  period: string;
  updateNo: number;
  updateDateKey: string;
  summaryPreview?: string | null;
  questions: SummarySessionQuestion[];
  answers?: SummarySessionAnswer[];
}) {
  await expirePendingSummarySessionsForUser(input.userId);

  return db.summarySession.create({
    data: {
      userId: input.userId,
      projectId: input.projectId ?? null,
      channelId: input.channelId,
      period: input.period,
      updateNo: input.updateNo,
      updateDateKey: input.updateDateKey,
      summaryPreview: input.summaryPreview ?? null,
      questions: input.questions as unknown as Prisma.InputJsonValue,
      answers: (input.answers ?? []) as unknown as Prisma.InputJsonValue,
      expiresAt: sessionExpiryDate(),
    },
  });
}

export async function createCompletedSummarySession(input: {
  userId: string;
  projectId?: string | null;
  channelId: string;
  period: string;
  updateNo: number;
  updateDateKey: string;
  summaryPreview: string;
}) {
  await expirePendingSummarySessionsForUser(input.userId);

  return db.summarySession.create({
    data: {
      userId: input.userId,
      projectId: input.projectId ?? null,
      channelId: input.channelId,
      period: input.period,
      updateNo: input.updateNo,
      updateDateKey: input.updateDateKey,
      summaryPreview: input.summaryPreview,
      questions: [] as Prisma.InputJsonValue,
      answers: [] as Prisma.InputJsonValue,
      status: SummarySessionStatus.completed,
      expiresAt: sessionExpiryDate(),
      completedAt: new Date(),
    },
  });
}

export async function getPendingSummarySession(userId: string) {
  const now = new Date();
  const session = await db.summarySession.findFirst({
    where: {
      userId,
      status: SummarySessionStatus.pending,
      expiresAt: {
        gt: now,
      },
    },
    include: {
      project: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!session) {
    return null;
  }

  return session;
}

export async function updatePendingSummarySession(
  sessionId: string,
  input: {
    summaryPreview?: string | null;
    questions: SummarySessionQuestion[];
    answers: SummarySessionAnswer[];
  },
) {
  return db.summarySession.update({
    where: { id: sessionId },
    data: {
      summaryPreview: input.summaryPreview ?? null,
      questions: input.questions as unknown as Prisma.InputJsonValue,
      answers: input.answers as unknown as Prisma.InputJsonValue,
      expiresAt: sessionExpiryDate(),
    },
  });
}

export async function completeSummarySession(sessionId: string) {
  return db.summarySession.update({
    where: { id: sessionId },
    data: {
      status: SummarySessionStatus.completed,
      completedAt: new Date(),
      questions: [] as Prisma.InputJsonValue,
    },
  });
}

export async function expireSummarySession(sessionId: string) {
  return db.summarySession.update({
    where: { id: sessionId },
    data: {
      status: SummarySessionStatus.expired,
    },
  });
}
