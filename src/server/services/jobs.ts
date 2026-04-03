import { randomUUID } from "crypto";
import { Prisma, ScheduledJobStatus } from "@prisma/client";
import { db } from "@/server/db";

const DEFAULT_LEASE_MS = 15 * 60 * 1000;
const TRANSACTION_RETRY_LIMIT = 3;

interface ScheduledJobLease {
  jobKey: string;
  leaseToken: string;
  leaseExpiresAt: Date;
  startedAt: Date;
}

function isRetryableTransactionError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2034"
  );
}

function normalizeNestedJsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeNestedJsonValue(entry));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeNestedJsonValue(entry)]),
    );
  }

  return String(value);
}

function normalizeJobSummary(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.DbNull | typeof Prisma.JsonNull {
  if (value === null || value === undefined) {
    return Prisma.DbNull;
  }

  return normalizeNestedJsonValue(value) ?? Prisma.JsonNull;
}

export async function tryAcquireScheduledJobLease(input: {
  jobKey: string;
  leaseMs?: number;
}) {
  const leaseMs = input.leaseMs ?? DEFAULT_LEASE_MS;

  for (let attempt = 0; attempt < TRANSACTION_RETRY_LIMIT; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const now = new Date();
        const leaseToken = randomUUID();
        const leaseExpiresAt = new Date(now.getTime() + leaseMs);
        const existing = await tx.scheduledJob.findUnique({
          where: { jobKey: input.jobKey },
        });

        if (existing?.leaseToken && existing.leaseExpiresAt && existing.leaseExpiresAt > now) {
          return null;
        }

        if (existing) {
          await tx.scheduledJob.update({
            where: { jobKey: input.jobKey },
            data: {
              leaseToken,
              leaseExpiresAt,
              lastStartedAt: now,
              lastStatus: ScheduledJobStatus.running,
              lastError: null,
            },
          });
        } else {
          await tx.scheduledJob.create({
            data: {
              jobKey: input.jobKey,
              leaseToken,
              leaseExpiresAt,
              lastStartedAt: now,
              lastStatus: ScheduledJobStatus.running,
            },
          });
        }

        return {
          jobKey: input.jobKey,
          leaseToken,
          leaseExpiresAt,
          startedAt: now,
        } satisfies ScheduledJobLease;
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === TRANSACTION_RETRY_LIMIT - 1) {
        throw error;
      }
    }
  }

  return null;
}

export async function completeScheduledJob(input: {
  jobKey: string;
  leaseToken: string;
  summary?: unknown;
}) {
  await db.scheduledJob.updateMany({
    where: {
      jobKey: input.jobKey,
      leaseToken: input.leaseToken,
    },
    data: {
      leaseToken: null,
      leaseExpiresAt: null,
      lastCompletedAt: new Date(),
      lastStatus: ScheduledJobStatus.completed,
      lastError: null,
      lastSummary: normalizeJobSummary(input.summary),
    },
  });
}

export async function failScheduledJob(input: {
  jobKey: string;
  leaseToken: string;
  error: unknown;
}) {
  const message =
    typeof input.error === "object" && input.error !== null && "message" in input.error
      ? String((input.error as { message?: unknown }).message ?? "Unknown error")
      : String(input.error);

  await db.scheduledJob.updateMany({
    where: {
      jobKey: input.jobKey,
      leaseToken: input.leaseToken,
    },
    data: {
      leaseToken: null,
      leaseExpiresAt: null,
      lastStatus: ScheduledJobStatus.failed,
      lastError: message.slice(0, 4000),
      lastSummary: Prisma.DbNull,
    },
  });
}

export async function runScheduledJob<T>(input: {
  jobKey: string;
  leaseMs?: number;
  task: (lease: ScheduledJobLease) => Promise<T>;
}) {
  const lease = await tryAcquireScheduledJobLease({
    jobKey: input.jobKey,
    leaseMs: input.leaseMs,
  });

  if (!lease) {
    return {
      acquired: false as const,
      skipped: true as const,
      jobKey: input.jobKey,
    };
  }

  try {
    const result = await input.task(lease);
    await completeScheduledJob({
      jobKey: input.jobKey,
      leaseToken: lease.leaseToken,
      summary: result,
    });

    return {
      acquired: true as const,
      skipped: false as const,
      jobKey: input.jobKey,
      result,
    };
  } catch (error) {
    await failScheduledJob({
      jobKey: input.jobKey,
      leaseToken: lease.leaseToken,
      error,
    });
    throw error;
  }
}
