import { randomUUID } from "crypto";
import { db } from "@/server/db";

function getAppUrl() {
  return process.env.APP_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
}

async function postSlackMessage(channel: string, text: string) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return;
  }

  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel,
      text,
    }),
  });
}

export async function createAuthLinkToken(slackUserId: string, slackTeamId: string) {
  const token = randomUUID();

  await db.linkToken.create({
    data: {
      slackUserId,
      slackTeamId,
      token,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
    },
  });

  return token;
}

export function buildAuthLink(token: string) {
  return `${getAppUrl()}/auth?token=${encodeURIComponent(token)}`;
}

export async function sendAuthLinkDm(input: {
  slackUserId: string;
  slackTeamId: string;
  reason?: string;
}) {
  const token = await createAuthLinkToken(input.slackUserId, input.slackTeamId);
  const link = buildAuthLink(token);

  const text = [
    input.reason ?? "Connect your accounts to finish setting up Standup Bot.",
    `<${link}|Open your secure auth page>`,
    "From there you can connect GitHub and Linear, review visible projects, and pick your default repo.",
  ].join("\n");

  await postSlackMessage(input.slackUserId, text);
  return link;
}

export async function getSlackUserProfile(slackUserId: string) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return null;
  }

  const response = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    ok?: boolean;
    user?: {
      name?: string;
      profile?: {
        display_name?: string;
        real_name?: string;
        image_72?: string;
        image_192?: string;
      };
    };
  };

  if (!payload.ok || !payload.user) {
    return null;
  }

  const profile = payload.user.profile;
  const displayName =
    profile?.display_name?.trim() ||
    profile?.real_name?.trim() ||
    payload.user.name?.trim() ||
    null;

  return {
    displayName,
    avatarUrl: profile?.image_72 ?? profile?.image_192 ?? null,
  };
}

export async function sendAuthChangeDm(slackUserId: string, provider: "github" | "linear", connected: boolean) {
  const action = connected ? "connected" : "disconnected";
  await postSlackMessage(
    slackUserId,
    `${provider === "github" ? "GitHub" : "Linear"} was ${action} successfully in Standup Bot.`,
  );
}
