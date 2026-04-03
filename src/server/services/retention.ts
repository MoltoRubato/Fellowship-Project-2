import { EntrySource } from "@prisma/client";
import { db } from "@/server/db";

function readRetentionDays(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function daysAgo(now: Date, days: number) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function getRetentionPolicy() {
  return {
    usedLinkTokensDays: readRetentionDays("RETENTION_USED_LINK_TOKENS_DAYS", 2),
    expiredLinkTokensDays: readRetentionDays("RETENTION_EXPIRED_LINK_TOKENS_DAYS", 7),
    pendingSummarySessionsDays: readRetentionDays("RETENTION_PENDING_SUMMARY_DAYS", 7),
    completedSummarySessionsDays: readRetentionDays("RETENTION_COMPLETED_SUMMARY_DAYS", 45),
    externalLogEntriesDays: readRetentionDays("RETENTION_EXTERNAL_LOG_DAYS", 45),
    manualLogEntriesDays: readRetentionDays("RETENTION_MANUAL_LOG_DAYS", 180),
    deletedLogEntriesDays: readRetentionDays("RETENTION_DELETED_LOG_DAYS", 30),
    reminderDeliveriesDays: readRetentionDays("RETENTION_REMINDER_DELIVERY_DAYS", 30),
  };
}

export function getRetentionCutoffs(now = new Date()) {
  const policy = getRetentionPolicy();

  return {
    policy,
    usedLinkTokensBefore: daysAgo(now, policy.usedLinkTokensDays),
    expiredLinkTokensBefore: daysAgo(now, policy.expiredLinkTokensDays),
    pendingSummarySessionsBefore: daysAgo(now, policy.pendingSummarySessionsDays),
    completedSummarySessionsBefore: daysAgo(now, policy.completedSummarySessionsDays),
    externalLogEntriesBefore: daysAgo(now, policy.externalLogEntriesDays),
    manualLogEntriesBefore: daysAgo(now, policy.manualLogEntriesDays),
    deletedLogEntriesBefore: daysAgo(now, policy.deletedLogEntriesDays),
    reminderDeliveriesBefore: daysAgo(now, policy.reminderDeliveriesDays),
  };
}

export async function runRetentionCleanup(now = new Date()) {
  const cutoffs = getRetentionCutoffs(now);

  const [
    usedLinkTokens,
    expiredLinkTokens,
    pendingSummarySessions,
    completedSummarySessions,
    externalLogEntries,
    manualLogEntries,
    deletedLogEntries,
    reminderDeliveries,
  ] = await Promise.all([
    db.linkToken.deleteMany({
      where: {
        used: true,
        createdAt: {
          lt: cutoffs.usedLinkTokensBefore,
        },
      },
    }),
    db.linkToken.deleteMany({
      where: {
        used: false,
        expiresAt: {
          lt: cutoffs.expiredLinkTokensBefore,
        },
      },
    }),
    db.summarySession.deleteMany({
      where: {
        status: {
          in: ["pending", "expired"],
        },
        createdAt: {
          lt: cutoffs.pendingSummarySessionsBefore,
        },
      },
    }),
    db.summarySession.deleteMany({
      where: {
        status: "completed",
        completedAt: {
          lt: cutoffs.completedSummarySessionsBefore,
        },
      },
    }),
    db.logEntry.deleteMany({
      where: {
        source: {
          in: [
            EntrySource.github_commit,
            EntrySource.github_pr,
            EntrySource.linear_issue,
          ],
        },
        createdAt: {
          lt: cutoffs.externalLogEntriesBefore,
        },
      },
    }),
    db.logEntry.deleteMany({
      where: {
        source: {
          in: [EntrySource.manual, EntrySource.dm],
        },
        deletedAt: null,
        createdAt: {
          lt: cutoffs.manualLogEntriesBefore,
        },
      },
    }),
    db.logEntry.deleteMany({
      where: {
        deletedAt: {
          not: null,
          lt: cutoffs.deletedLogEntriesBefore,
        },
      },
    }),
    db.reminderDelivery.deleteMany({
      where: {
        sentAt: {
          lt: cutoffs.reminderDeliveriesBefore,
        },
      },
    }),
  ]);

  return {
    ranAt: now.toISOString(),
    policy: cutoffs.policy,
    deleted: {
      usedLinkTokens: usedLinkTokens.count,
      expiredLinkTokens: expiredLinkTokens.count,
      pendingSummarySessions: pendingSummarySessions.count,
      completedSummarySessions: completedSummarySessions.count,
      externalLogEntries: externalLogEntries.count,
      manualLogEntries: manualLogEntries.count,
      deletedLogEntries: deletedLogEntries.count,
      reminderDeliveries: reminderDeliveries.count,
    },
  };
}
