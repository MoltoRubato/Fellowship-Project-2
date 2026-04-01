import type { App } from "@slack/bolt";
import type { ActionArgs, ViewArgs } from "../types.js";
import type { SummaryQuestion, SummaryAnswer } from "@/server/services/summary";
import {
  SUMMARY_QUESTIONS_MODAL_CALLBACK_ID,
} from "../shared/index.js";
import { filterUnansweredSummaryQuestions } from "@/lib/summary-questions";
import { optionNeedsActualValue } from "@/lib/summary-placeholders";
import {
  getUserContextBySlackId,
} from "@/server/services/standup";
import {
  getPendingSummarySession,
  updatePendingSummarySession,
  completeSummarySession,
  expireSummarySession,
} from "@/server/services/summarySessions";
import { generateSummaryResult } from "./generate-result";
import {
  buildSingleQuestionBlocks,
  mergeAnswers,
  resolveSingleQuestionAnswer,
} from "./question-modal-helpers";

interface QuestionButtonValue {
  sessionId: string;
  questionIndex: number;
}

interface QuestionModalMetadata {
  sessionId: string;
  questionIndex: number;
  messageTs: string;
  dmChannelId: string;
}

export async function sendQuestionsDM(
  client: App["client"],
  slackUserId: string,
  sessionId: string,
  updateNo: number,
  repo: string | null,
  summaryPreview: string | null,
  questions: SummaryQuestion[],
) {
  const header = `*Update #${updateNo}*${repo ? ` for \`${repo}\`` : ""}`;
  const previewLine = summaryPreview
    ? `\n\n> ${summaryPreview.split("\n").join("\n> ")}`
    : "";
  const intro = `${header}${previewLine}\n\nI need ${questions.length} clarification${questions.length === 1 ? "" : "s"} before I can post the summary.`;

  await client.chat.postMessage({
    channel: slackUserId,
    text: intro,
  });

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i]!;
    const needsActualValue = question.options.some((option) => optionNeedsActualValue(option));
    const optionsHint = question.options.length
      ? `\n_Options: ${question.options.join(" | ")} | Other_${needsActualValue ? "\n_Choose the best pattern, then type the real value in the answer modal._" : ""}`
      : "";

    const buttonValue: QuestionButtonValue = { sessionId, questionIndex: i };

    await client.chat.postMessage({
      channel: slackUserId,
      text: `*Q${i + 1}.* ${question.message}${optionsHint}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Q${i + 1}.* ${question.message}${optionsHint}`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Answer" },
              action_id: "summary_questions_open",
              value: JSON.stringify(buttonValue),
              style: "primary",
            },
          ],
        },
      ],
    });
  }
}

export async function handleSummaryQuestionsOpen(args: ActionArgs) {
  const { ack, body, client, action } = args;
  await ack();

  const rawValue = (action as { value?: string }).value;
  if (!rawValue) {
    return;
  }

  const triggerId = body.trigger_id;
  if (!triggerId) {
    return;
  }

  const buttonValue = JSON.parse(rawValue) as QuestionButtonValue;
  const messageTs = (body as { message?: { ts?: string } }).message?.ts ?? "";
  const dmChannelId = body.channel?.id ?? "";

  const user = await getUserContextBySlackId(body.user.id);
  if (!user) {
    await client.chat.postMessage({
      channel: body.user.id,
      text: "I couldn't find your profile. Please run `/auth` and try again.",
    });
    return;
  }

  const session = await getPendingSummarySession(user.id);
  if (!session) {
    await client.chat.postMessage({
      channel: body.user.id,
      text: "This session has expired. Please run `/summarise` again.",
    });
    return;
  }

  const questions = Array.isArray(session.questions)
    ? (session.questions as unknown as SummaryQuestion[])
    : [];
  const question = questions[buttonValue.questionIndex];

  if (!question) {
    return;
  }

  const existingAnswers = Array.isArray(session.answers)
    ? (session.answers as unknown as SummaryAnswer[])
    : [];
  const alreadyAnswered = existingAnswers.some((a) => a.message === question.message);
  if (alreadyAnswered) {
    await client.chat.postMessage({
      channel: body.user.id,
      text: "You've already answered this question.",
    });
    return;
  }

  const metadata: QuestionModalMetadata = {
    sessionId: session.id,
    questionIndex: buttonValue.questionIndex,
    messageTs,
    dmChannelId,
  };

  const modalBlocks = buildSingleQuestionBlocks(question);
  const titleText = `Q${buttonValue.questionIndex + 1} of ${questions.length}`;

  await client.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: SUMMARY_QUESTIONS_MODAL_CALLBACK_ID,
      private_metadata: JSON.stringify(metadata),
      title: {
        type: "plain_text",
        text: titleText,
      },
      submit: {
        type: "plain_text",
        text: "Submit",
      },
      close: {
        type: "plain_text",
        text: "Cancel",
      },
      blocks: modalBlocks,
    },
  });
}

export async function handleSummaryQuestionsSubmit(args: ViewArgs) {
  const { ack, body, client, view } = args;
  const metadata = JSON.parse(view.private_metadata || "{}") as QuestionModalMetadata;
  const slackUserId = body.user.id;
  const teamId = body.team?.id ?? "";

  const user = await getUserContextBySlackId(slackUserId);
  if (!user) {
    await ack();
    await client.chat.postMessage({
      channel: slackUserId,
      text: "I couldn't find your profile. Please run `/auth` and try again.",
    });
    return;
  }

  const session = await getPendingSummarySession(user.id);
  if (!session) {
    await ack();
    await client.chat.postMessage({
      channel: slackUserId,
      text: "This session has expired. Please run `/summarise` again.",
    });
    return;
  }

  const questions = Array.isArray(session.questions)
    ? (session.questions as unknown as SummaryQuestion[])
    : [];
  const existingAnswers = Array.isArray(session.answers)
    ? (session.answers as unknown as SummaryAnswer[])
    : [];

  const question = questions[metadata.questionIndex];
  if (!question) {
    await ack();
    return;
  }

  const answerResult = resolveSingleQuestionAnswer(view.state?.values ?? {}, question);

  if (!answerResult.ok) {
    await ack({
      response_action: "errors",
      errors: {
        [answerResult.blockId]: answerResult.error,
      },
    });
    return;
  }

  await ack();

  const answer = answerResult.answer;
  const mergedAnswers = mergeAnswers(existingAnswers, [answer]);

  // Update the button DM to show the answer (remove button)
  await updateDMToAnswered(client, metadata, question, answer.answer);

  // Check if all questions are now answered
  const allAnswered = questions.every(
    (q) => mergedAnswers.some((a) => a.message === q.message),
  );

  if (!allAnswered) {
    // Save progress, wait for remaining questions
    await updatePendingSummarySession(session.id, {
      summaryPreview: session.summaryPreview,
      questions,
      answers: mergedAnswers,
    });
    return;
  }

  // All answered — notify and process
  const processingMsg = await client.chat.postMessage({
    channel: slackUserId,
    text: "All questions answered. Processing your summary...",
  });

  const resolved = await generateSummaryResult({
    slackUserId,
    slackTeamId: teamId,
    period: session.period === "week" ? "week" : "today",
    repo: session.project?.githubRepo ?? null,
    updateNo: session.updateNo,
    answers: mergedAnswers,
  });

  // Clean up the processing message
  if (processingMsg.ts && processingMsg.channel) {
    try {
      await client.chat.delete({
        channel: processingMsg.channel,
        ts: processingMsg.ts,
      });
    } catch {
      // ignore
    }
  }

  if (!resolved.ok) {
    await expireSummarySession(session.id);
    await client.chat.postMessage({
      channel: slackUserId,
      text: resolved.text,
    });
    return;
  }

  const followUpQuestions = filterUnansweredSummaryQuestions(
    resolved.summaryResult.questions,
    mergedAnswers,
  );

  if (followUpQuestions.length) {
    await updatePendingSummarySession(session.id, {
      summaryPreview: resolved.summaryResult.summary,
      questions: followUpQuestions,
      answers: mergedAnswers,
    });

    await sendQuestionsDM(
      client,
      slackUserId,
      session.id,
      resolved.updateNo,
      session.project?.githubRepo ?? null,
      resolved.summaryResult.summary,
      followUpQuestions,
    );
    return;
  }

  if (!resolved.summaryResult.summary) {
    await expireSummarySession(session.id);
    await client.chat.postMessage({
      channel: slackUserId,
      text: "I couldn't generate a final summary after those answers. Please run `/summarise` again.",
    });
    return;
  }

  await postCompletedSummary(client, {
    sessionId: session.id,
    channelId: session.channelId,
    slackUserId,
    updateNo: resolved.updateNo,
    repo: session.project?.githubRepo ?? null,
    summary: resolved.summaryResult.summary,
  });
}

async function postCompletedSummary(
  client: App["client"],
  input: {
    sessionId: string;
    channelId: string;
    slackUserId: string;
    updateNo: number;
    repo: string | null;
    summary: string;
  },
) {
  await completeSummarySession(input.sessionId);

  await client.chat.postMessage({
    channel: input.channelId,
    text: input.summary,
  });

  await client.chat.postMessage({
    channel: input.slackUserId,
    text: `Posted Update #${input.updateNo}${input.repo ? ` for ${input.repo}` : ""}.`,
  });
}

async function updateDMToAnswered(
  client: App["client"],
  metadata: QuestionModalMetadata,
  question: SummaryQuestion,
  answer: string,
) {
  if (!metadata.messageTs || !metadata.dmChannelId) {
    return;
  }

  try {
    await client.chat.update({
      channel: metadata.dmChannelId,
      ts: metadata.messageTs,
      text: `~Q${metadata.questionIndex + 1}. ${question.message}~\n*A:* ${answer}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `~Q${metadata.questionIndex + 1}. ${question.message}~\n*A:* ${answer}`,
          },
        },
      ],
    });
  } catch {
    // Message may already be deleted
  }
}
