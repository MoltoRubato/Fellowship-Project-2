import { Prisma } from "@prisma/client";

async function reserveDailySequenceValue(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    dateKey: string;
    field: "nextLogDisplayId" | "nextSummaryUpdateNo";
  },
) {
  const createdDefaults =
    input.field === "nextLogDisplayId"
      ? { nextLogDisplayId: 2, nextSummaryUpdateNo: 1 }
      : { nextLogDisplayId: 1, nextSummaryUpdateNo: 2 };

  const sequence = await tx.dailySequence.upsert({
    where: {
      userId_dateKey: {
        userId: input.userId,
        dateKey: input.dateKey,
      },
    },
    create: {
      userId: input.userId,
      dateKey: input.dateKey,
      ...createdDefaults,
    },
    update: {
      [input.field]: {
        increment: 1,
      },
    },
    select: {
      nextLogDisplayId: true,
      nextSummaryUpdateNo: true,
    },
  });

  return input.field === "nextLogDisplayId"
    ? sequence.nextLogDisplayId - 1
    : sequence.nextSummaryUpdateNo - 1;
}

export async function reserveNextDailyLogDisplayIdTx(
  tx: Prisma.TransactionClient,
  userId: string,
  dateKey: string,
) {
  return reserveDailySequenceValue(tx, {
    userId,
    dateKey,
    field: "nextLogDisplayId",
  });
}

export async function reserveNextDailySummaryUpdateNoTx(
  tx: Prisma.TransactionClient,
  userId: string,
  dateKey: string,
) {
  return reserveDailySequenceValue(tx, {
    userId,
    dateKey,
    field: "nextSummaryUpdateNo",
  });
}
