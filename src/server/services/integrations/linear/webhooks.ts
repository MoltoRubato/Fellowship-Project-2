import { createHmac, timingSafeEqual } from "crypto";
import { EntrySource, EntryType } from "@prisma/client";
import { db } from "@/server/db";
import { createLogEntryForUser } from "@/server/services/standup/entries";
import { USER_CONTEXT_INCLUDE } from "@/server/services/standup/types";

interface LinearWebhookPayload {
  action?: string | null;
  type?: string | null;
  actor?: {
    id?: string | null;
    email?: string | null;
    type?: string | null;
  } | null;
  data?: {
    id?: string | null;
    identifier?: string | null;
    title?: string | null;
    url?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    state?: {
      name?: string | null;
    } | null;
    project?: {
      id?: string | null;
      name?: string | null;
    } | null;
    projectId?: string | null;
  } | null;
  url?: string | null;
  createdAt?: string | null;
  webhookTimestamp?: number | null;
}

const LINEAR_WEBHOOK_MAX_SKEW_MS = 60 * 1000;

function parseWebhookDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildLinearWebhookContent(payload: LinearWebhookPayload) {
  const identifier = payload.data?.identifier?.trim() ?? "Issue";
  const state = payload.data?.state?.name?.trim() ?? "Updated";

  if (payload.action === "create") {
    return `${identifier} created`;
  }

  return `${identifier} moved to ${state}`;
}

function buildLinearWebhookTitle(payload: LinearWebhookPayload) {
  const identifier = payload.data?.identifier?.trim();
  const title = payload.data?.title?.trim();

  if (identifier && title) {
    return `${identifier} ${title}`;
  }

  return title ?? identifier ?? "Linear issue";
}

function getLinearWebhookProjectId(payload: LinearWebhookPayload) {
  return payload.data?.projectId ?? payload.data?.project?.id ?? null;
}

export function verifyLinearWebhookSignature(rawBody: string, signatureHeader: string | null) {
  const secret = process.env.LINEAR_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) {
    return false;
  }

  const computed = createHmac("sha256", secret).update(rawBody).digest();
  const provided = Buffer.from(signatureHeader, "hex");

  if (provided.length !== computed.length) {
    return false;
  }

  return timingSafeEqual(computed, provided);
}

export function isFreshLinearWebhook(
  webhookTimestamp: number | null | undefined,
  nowMs = Date.now(),
) {
  if (typeof webhookTimestamp !== "number") {
    return false;
  }

  return Math.abs(nowMs - webhookTimestamp) <= LINEAR_WEBHOOK_MAX_SKEW_MS;
}

async function listLinearWebhookRecipients(input: {
  actorId?: string | null;
  actorEmail?: string | null;
  projectId: string;
}) {
  if (!input.actorId && !input.actorEmail) {
    return [];
  }

  const accounts = await db.account.findMany({
    where: {
      provider: "linear",
      user: {
        projects: {
          some: {
            linearProjectId: input.projectId,
          },
        },
      },
      OR: [
        ...(input.actorId ? [{ providerAccountId: input.actorId }] : []),
        ...(input.actorEmail
          ? [{
              username: {
                equals: input.actorEmail,
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

export async function handleLinearWebhook(payload: LinearWebhookPayload) {
  const projectId = getLinearWebhookProjectId(payload);

  if (payload.type !== "Issue" || !projectId || !payload.data?.id) {
    return {
      ignored: true,
      reason: "unsupported_payload",
      usersMatched: 0,
      itemsWritten: 0,
    };
  }

  if (payload.action !== "create" && payload.action !== "update") {
    return {
      ignored: true,
      reason: "unsupported_action",
      usersMatched: 0,
      itemsWritten: 0,
    };
  }

  const recipients = await listLinearWebhookRecipients({
    actorId: payload.actor?.id ?? null,
    actorEmail: payload.actor?.email ?? null,
    projectId,
  });

  const createdAt =
    parseWebhookDate(payload.data?.updatedAt) ??
    parseWebhookDate(payload.data?.createdAt) ??
    parseWebhookDate(payload.createdAt) ??
    new Date();
  const title = buildLinearWebhookTitle(payload);
  const content = buildLinearWebhookContent(payload);
  const externalUrl = payload.url?.trim() || payload.data?.url?.trim() || undefined;
  const externalId = `linear-issue:${payload.data.id}:${payload.action}:${createdAt.toISOString()}`;
  let itemsWritten = 0;

  for (const user of recipients) {
    const repos = user.projects.filter((project) => project.linearProjectId === projectId);

    for (const project of repos) {
      await createLogEntryForUser(
        {
          id: user.id,
          slackUserId: user.slackUserId,
        },
        {
          repo: project.githubRepo,
          content,
          title,
          entryType: EntryType.update,
          source: EntrySource.linear_issue,
          externalId,
          externalUrl,
          createdAt,
        },
      );
      itemsWritten += 1;
    }
  }

  return {
    ignored: false,
    usersMatched: recipients.length,
    itemsWritten,
  };
}
