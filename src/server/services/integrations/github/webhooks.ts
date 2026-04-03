import { createHmac, timingSafeEqual } from "crypto";
import { EntryType, Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { createLogEntryForUser } from "@/server/services/standup/entries";
import { normalizeRepo } from "@/server/services/standup/repo";
import { USER_CONTEXT_INCLUDE } from "@/server/services/standup/types";
import {
  buildPullRequestContent,
  buildPullRequestExternalId,
  getPullRequestStatus,
} from "./activity";
import type { GithubActivityItem, GithubPullRequestMetadata } from "./types";

interface GithubWebhookSender {
  id?: number | null;
  login?: string | null;
}

interface GithubWebhookPayload {
  action?: string | null;
  sender?: GithubWebhookSender | null;
  repository?: {
    full_name?: string | null;
  } | null;
  commits?: Array<{
    id?: string | null;
    message?: string | null;
    timestamp?: string | null;
    url?: string | null;
  }> | null;
  head_commit?: {
    id?: string | null;
    message?: string | null;
    timestamp?: string | null;
    url?: string | null;
  } | null;
  pull_request?: {
    number?: number | null;
    title?: string | null;
    html_url?: string | null;
    state?: string | null;
    draft?: boolean | null;
    merged?: boolean | null;
    merged_at?: string | null;
    closed_at?: string | null;
    updated_at?: string | null;
    requested_reviewers?: Array<unknown> | null;
    requested_teams?: Array<unknown> | null;
  } | null;
}

function parseWebhookDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeGithubSignature(signatureHeader: string | null) {
  if (!signatureHeader?.startsWith("sha256=")) {
    return null;
  }

  return signatureHeader.slice("sha256=".length);
}

function buildPullRequestMetadataFromWebhook(input: {
  mergedAt?: string | null;
  state?: string | null;
  draft?: boolean | null;
  requestedReviewers?: Array<unknown> | null;
  requestedTeams?: Array<unknown> | null;
  pullNumber: number;
}) {
  const state = input.mergedAt
    ? "closed"
    : input.state === "closed"
      ? "closed"
      : "open";
  const draft = Boolean(input.draft);
  const requestedReviewerCount = input.requestedReviewers?.length ?? 0;
  const requestedTeamCount = input.requestedTeams?.length ?? 0;
  const reviewRequested = requestedReviewerCount + requestedTeamCount > 0;

  return {
    githubPr: {
      number: input.pullNumber,
      state,
      draft,
      awaitingReview: state === "open" && !draft && reviewRequested,
      reviewRequested,
      requestedReviewerCount,
      requestedTeamCount,
    } satisfies GithubPullRequestMetadata,
  };
}

export function verifyGithubWebhookSignature(rawBody: string, signatureHeader: string | null) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const normalizedSignature = normalizeGithubSignature(signatureHeader);

  if (!secret || !normalizedSignature) {
    return false;
  }

  const computed = createHmac("sha256", secret).update(rawBody).digest();
  const provided = Buffer.from(normalizedSignature, "hex");

  if (provided.length !== computed.length) {
    return false;
  }

  return timingSafeEqual(computed, provided);
}

export function buildGithubWebhookItems(
  eventName: string,
  payload: GithubWebhookPayload,
): GithubActivityItem[] {
  const repo = normalizeRepo(payload.repository?.full_name ?? null);
  if (!repo) {
    return [];
  }

  if (eventName === "push") {
    const commits = payload.commits?.length ? payload.commits : payload.head_commit ? [payload.head_commit] : [];
    const results: GithubActivityItem[] = [];

    for (const commit of commits) {
      const sha = commit.id?.trim();
      const message = commit.message?.split("\n")[0]?.trim();
      const createdAt = parseWebhookDate(commit.timestamp);

      if (!sha || !message || !createdAt || message.startsWith("Merge")) {
        continue;
      }

      results.push({
        repo,
        title: message,
        content: `Commit to ${repo}: ${message}`,
        source: "github_commit",
        externalId: `github-commit:${repo}:${sha}`,
        externalUrl: commit.url?.trim() || `https://github.com/${repo}/commit/${sha}`,
        createdAt,
      });
    }

    return results.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  if (eventName === "pull_request") {
    const pullRequest = payload.pull_request;
    const pullNumber = pullRequest?.number ?? null;
    const title = pullRequest?.title?.trim();
    const htmlUrl = pullRequest?.html_url?.trim();

    if (!pullNumber || !title || !htmlUrl) {
      return [];
    }

    const statusInfo = getPullRequestStatus({
      mergedAt: pullRequest?.merged ? pullRequest.merged_at ?? null : pullRequest?.merged_at ?? null,
      closedAt: pullRequest?.closed_at ?? null,
      updatedAt: pullRequest?.updated_at ?? null,
      state: pullRequest?.state ?? null,
    });

    if (!statusInfo.createdAt) {
      return [];
    }

    return [
      {
        repo,
        title,
        content: buildPullRequestContent(repo, title, statusInfo.status),
        source: "github_pr",
        externalId: buildPullRequestExternalId(
          repo,
          pullNumber,
          statusInfo.status,
          statusInfo.createdAt.toISOString(),
        ),
        externalUrl: htmlUrl,
        metadata: buildPullRequestMetadataFromWebhook({
          pullNumber,
          mergedAt: pullRequest?.merged_at ?? null,
          state: pullRequest?.state ?? null,
          draft: pullRequest?.draft ?? false,
          requestedReviewers: pullRequest?.requested_reviewers ?? [],
          requestedTeams: pullRequest?.requested_teams ?? [],
        }),
        createdAt: statusInfo.createdAt,
      },
    ];
  }

  return [];
}

async function listGithubWebhookRecipients(input: {
  repo: string;
  sender?: GithubWebhookSender | null;
}) {
  const actorId = input.sender?.id ? String(input.sender.id) : null;
  const actorLogin = input.sender?.login?.trim() ?? null;

  if (!actorId && !actorLogin) {
    return [];
  }

  const accounts = await db.account.findMany({
    where: {
      provider: "github",
      user: {
        projects: {
          some: {
            githubRepo: input.repo,
          },
        },
      },
      OR: [
        ...(actorId ? [{ providerAccountId: actorId }] : []),
        ...(actorLogin
          ? [{
              username: {
                equals: actorLogin,
                mode: "insensitive" as const,
              },
            }]
          : []),
      ],
    },
    include: {
      user: {
        include: USER_CONTEXT_INCLUDE,
      },
    },
  });

  return accounts.map((account) => account.user);
}

export async function handleGithubWebhook(eventName: string, payload: GithubWebhookPayload) {
  if (eventName === "ping") {
    return {
      eventName,
      ignored: true,
      reason: "ping",
      usersMatched: 0,
      itemsReceived: 0,
      itemsWritten: 0,
    };
  }

  const repo = normalizeRepo(payload.repository?.full_name ?? null);
  if (!repo) {
    return {
      eventName,
      ignored: true,
      reason: "missing_repo",
      usersMatched: 0,
      itemsReceived: 0,
      itemsWritten: 0,
    };
  }

  const items = buildGithubWebhookItems(eventName, payload);
  if (!items.length) {
    return {
      eventName,
      ignored: true,
      reason: "no_supported_activity",
      usersMatched: 0,
      itemsReceived: 0,
      itemsWritten: 0,
    };
  }

  const recipients = await listGithubWebhookRecipients({
    repo,
    sender: payload.sender,
  });

  let itemsWritten = 0;

  for (const user of recipients) {
    for (const item of items) {
      await createLogEntryForUser(
        {
          id: user.id,
          slackUserId: user.slackUserId,
        },
        {
          repo: item.repo,
          content: item.content,
          title: item.title,
          entryType: EntryType.update,
          source: item.source === "github_commit" ? "github_commit" : "github_pr",
          externalId: item.externalId,
          externalUrl: item.externalUrl,
          metadata: item.metadata as Prisma.InputJsonValue | undefined,
          createdAt: item.createdAt,
        },
      );
      itemsWritten += 1;
    }
  }

  return {
    eventName,
    ignored: false,
    usersMatched: recipients.length,
    itemsReceived: items.length,
    itemsWritten,
  };
}
