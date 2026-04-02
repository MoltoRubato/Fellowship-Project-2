import type { App } from "@slack/bolt";
import type { SummaryPeriod } from "../types.js";
import {
  postToResponseUrl,
  sendModalConfirmation,
} from "../shared/index.js";
import {
  createCompletedSummarySession,
} from "@/server/services/summarySessions";
import type { generateSummaryResult } from "./generate-result";

export async function deliverSummaryOutcome(input: {
  client: App["client"];
  slackUserId: string;
  channelId: string;
  period: SummaryPeriod;
  repos?: string[] | null;
  responseUrl?: string;
  result: Awaited<ReturnType<typeof generateSummaryResult>> & { ok: true };
}) {
  const { result } = input;

  if (!result.summaryResult.summary) {
    const fallbackText = "I couldn't generate a summary yet. Please try again.";
    if (input.responseUrl) {
      await postToResponseUrl(input.responseUrl, {
        response_type: "ephemeral",
        text: fallbackText,
        replace_original: true,
      });
      return;
    }

    await sendModalConfirmation(input.client, input.channelId, input.slackUserId, fallbackText);
    return;
  }

  await createCompletedSummarySession({
    userId: result.userId,
    projectId: result.projectId,
    channelId: input.channelId,
    period: input.period,
    updateNo: result.updateNo,
    updateDateKey: result.updateDateKey ?? new Date().toISOString().slice(0, 10),
    summaryPreview: result.summaryResult.summary,
  });

  if (input.responseUrl) {
    await postToResponseUrl(input.responseUrl, {
      response_type: "in_channel",
      text: result.summaryResult.summary,
      replace_original: true,
    });
    return;
  }

  await input.client.chat.postMessage({
    channel: input.channelId,
    text: result.summaryResult.summary,
  });
}
