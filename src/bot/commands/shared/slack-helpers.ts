import type { App } from "@slack/bolt";
import { ensureSlackUser, getUserContextBySlackId } from "@/server/services/standup";
import { sendAuthLinkDm } from "@/server/services/slack";

export async function resolveDefaultRepo(slackUserId: string) {
  const user = await getUserContextBySlackId(slackUserId);
  return user?.projects[0]?.githubRepo ?? null;
}

export async function loadUserForEntryModal(slackUserId: string, slackTeamId: string) {
  const { created } = await ensureSlackUser(slackUserId, slackTeamId);
  const user = await getUserContextBySlackId(slackUserId);
  return { created, user };
}

export async function maybeSendOnboardingLink(slackUserId: string, slackTeamId: string, created: boolean) {
  if (!created) {
    return false;
  }

  await sendAuthLinkDm({
    slackUserId,
    slackTeamId,
    reason: "You can start logging immediately, and this link lets you connect GitHub and Linear when you're ready.",
  });

  return true;
}

export async function postToResponseUrl(
  responseUrl: string,
  payload: {
    text: string;
    response_type?: "ephemeral" | "in_channel";
    replace_original?: boolean;
    delete_original?: boolean;
  },
) {
  await fetch(responseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function sendModalConfirmation(
  client: App["client"],
  channelId: string,
  userId: string,
  text: string,
  responseUrl?: string,
) {
  if (responseUrl) {
    await postToResponseUrl(responseUrl, {
      response_type: "ephemeral",
      text,
      replace_original: false,
    });
    return;
  }

  if (channelId.startsWith("D")) {
    await client.chat.postMessage({
      channel: channelId,
      text,
    });
    return;
  }

  await client.chat.postEphemeral({
    channel: channelId,
    user: userId,
    text,
  });
}
