import { Prisma } from "@prisma/client";
import { reserveNextDailyLogDisplayIdTx } from "@/server/services/daily-sequences";

async function archiveDeletedDisplayIdsTx(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    dateKey: string;
  },
) {
  const deletedEntries = await tx.logEntry.findMany({
    where: {
      userId: input.userId,
      displayDateKey: input.dateKey,
      deletedAt: { not: null },
      displayId: { gt: 0 },
    },
    orderBy: [{ updatedAt: "asc" }, { displayId: "asc" }],
    select: {
      id: true,
    },
  });

  if (!deletedEntries.length) {
    return;
  }

  const archivedDisplayIds = await tx.logEntry.aggregate({
    where: {
      userId: input.userId,
      displayDateKey: input.dateKey,
      displayId: { lt: 1 },
    },
    _min: {
      displayId: true,
    },
  });

  let nextArchivedDisplayId = Math.min(archivedDisplayIds._min.displayId ?? 0, 0) - 1;

  for (const entry of deletedEntries) {
    await tx.logEntry.update({
      where: { id: entry.id },
      data: {
        displayId: nextArchivedDisplayId,
      },
    });
    nextArchivedDisplayId -= 1;
  }
}

export async function reserveNextLogDisplayIdTx(
  tx: Prisma.TransactionClient,
  userId: string,
  dateKey: string,
) {
  return reserveNextDailyLogDisplayIdTx(tx, userId, dateKey);
}

export async function reserveNextImportedLogDisplayIdTx(
  tx: Prisma.TransactionClient,
  userId: string,
  dateKey: string,
) {
  const importedEntries = await tx.logEntry.aggregate({
    where: {
      userId,
      displayDateKey: dateKey,
      displayId: { lt: 1 },
    },
    _min: {
      displayId: true,
    },
  });

  return Math.min(importedEntries._min.displayId ?? 0, 0) - 1;
}

export async function realignNextLogDisplayIdTx(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    dateKey: string;
  },
) {
  await archiveDeletedDisplayIdsTx(tx, input);

  const activeEntries = await tx.logEntry.aggregate({
    where: {
      userId: input.userId,
      displayDateKey: input.dateKey,
      deletedAt: null,
      displayId: { gt: 0 },
    },
    _max: {
      displayId: true,
    },
  });

  const nextLogDisplayId = (activeEntries._max.displayId ?? 0) + 1;

  await tx.dailySequence.upsert({
    where: {
      userId_dateKey: {
        userId: input.userId,
        dateKey: input.dateKey,
      },
    },
    create: {
      userId: input.userId,
      dateKey: input.dateKey,
      nextLogDisplayId,
      nextSummaryUpdateNo: 1,
    },
    update: {
      nextLogDisplayId,
    },
  });
}
