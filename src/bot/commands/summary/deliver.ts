import type { App } from "@slack/bolt";
import type { SummaryPeriod } from "../types.js";
import {
  postToResponseUrl,
  sendModalConfirmation,
} from "../shared/index.js";
import {
  createCompletedSummarySession,
  createPendingSummarySession,
} from "@/server/services/summarySessions";
import { formatSummaryQuestionsMessage } from "./dm-followup";
import type { generateSummaryResult } from "./generate-result";

export async function deliverSummaryOutcome(input: {
  client: App["client"];
  slackUserId: string;
  channelId: string;
  period: SummaryPeriod;
  repo?: string | null;
  responseUrl?: string;
  result: Awaited<ReturnType<typeof generateSummaryResult>> & { ok: true };
}) {
  const { result } = input;

  if (result.summaryResult.questions.length) {
    await createPendingSummarySession({
      userId: result.userId,
      projectId: result.projectId,
      channelId: input.channelId,
      period: input.period,
      updateNo: result.updateNo,
      summaryPreview: result.summaryResult.summary,
      questions: result.summaryResult.questions,
    });

    const dmText = formatSummaryQuestionsMessage({
      updateNo: result.updateNo,
      repo: input.repo ?? null,
      summaryPreview: result.summaryResult.summary,
      questions: result.summaryResult.questions,
    });

    await input.client.chat.postMessage({
      channel: input.slackUserId,
      text: dmText,
    });

    const followUpText = "I need a couple of clarifications before I can post the summary. I sent them in DM.";
    if (input.responseUrl) {
      await postToResponseUrl(input.responseUrl, {
        response_type: "ephemeral",
        text: followUpText,
        replace_original: true,
      });
      return;
    }

    await sendModalConfirmation(input.client, input.channelId, input.slackUserId, followUpText);
    return;
  }

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
