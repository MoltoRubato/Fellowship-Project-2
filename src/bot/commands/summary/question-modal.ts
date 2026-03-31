import type { App } from "@slack/bolt";
import type { ActionArgs, ViewArgs } from "../types.js";
import type { SummaryQuestion, SummaryAnswer } from "@/server/services/summary";
import {
  SUMMARY_QUESTIONS_MODAL_CALLBACK_ID,
} from "../shared/index.js";
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

const OTHER_VALUE = "__other__";

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
    const optionsHint = question.options.length
      ? `\n_Options: ${question.options.join(" | ")} | Other_`
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
  await ack();

  const metadata = JSON.parse(view.private_metadata || "{}") as QuestionModalMetadata;
  const slackUserId = body.user.id;
  const teamId = body.team?.id ?? "";

  const user = await getUserContextBySlackId(slackUserId);
  if (!user) {
    await client.chat.postMessage({
      channel: slackUserId,
      text: "I couldn't find your profile. Please run `/auth` and try again.",
    });
    return;
  }

  const session = await getPendingSummarySession(user.id);
  if (!session) {
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
    return;
  }

  const answer = extractSingleAnswer(view.state?.values ?? {}, question);

  if (!answer) {
    return;
  }

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

  if (resolved.summaryResult.questions.length) {
    await updatePendingSummarySession(session.id, {
      summaryPreview: resolved.summaryResult.summary,
      questions: resolved.summaryResult.questions,
      answers: mergedAnswers,
    });

    await sendQuestionsDM(
      client,
      slackUserId,
      session.id,
      resolved.updateNo,
      session.project?.githubRepo ?? null,
      resolved.summaryResult.summary,
      resolved.summaryResult.questions,
    );
    return;
  }

  await completeSummarySession(session.id);

  if (resolved.summaryResult.summary) {
    await client.chat.postMessage({
      channel: session.channelId,
      text: resolved.summaryResult.summary,
    });
  }

  await client.chat.postMessage({
    channel: slackUserId,
    text: `Posted Update #${resolved.updateNo}${session.project?.githubRepo ? ` for ${session.project.githubRepo}` : ""}.`,
  });
}

// --- Helpers ---

function buildSingleQuestionBlocks(question: SummaryQuestion) {
  if (question.options.length) {
    return [
      {
        type: "input" as const,
        block_id: "sq_choice",
        label: { type: "plain_text" as const, text: question.message },
        element: {
          type: "radio_buttons" as const,
          action_id: "sq_choice_action",
          options: [
            ...question.options.map((opt) => ({
              text: { type: "plain_text" as const, text: opt },
              value: opt,
            })),
            {
              text: { type: "plain_text" as const, text: "Other" },
              value: OTHER_VALUE,
            },
          ],
        },
      },
      {
        type: "input" as const,
        block_id: "sq_other",
        label: { type: "plain_text" as const, text: "If Other, please specify:" },
        optional: true,
        element: {
          type: "plain_text_input" as const,
          action_id: "sq_other_action",
          placeholder: { type: "plain_text" as const, text: "Your answer..." },
        },
      },
    ];
  }

  return [
    {
      type: "input" as const,
      block_id: "sq_text",
      label: { type: "plain_text" as const, text: question.message },
      element: {
        type: "plain_text_input" as const,
        action_id: "sq_text_action",
        placeholder: { type: "plain_text" as const, text: "Your answer..." },
      },
    },
  ];
}

function extractSingleAnswer(
  values: Record<string, Record<string, unknown>>,
  question: SummaryQuestion,
): SummaryAnswer | null {
  if (question.options.length) {
    const radioState = values.sq_choice?.sq_choice_action as
      | { selected_option?: { value?: string } }
      | undefined;
    const selectedValue = radioState?.selected_option?.value;

    if (selectedValue === OTHER_VALUE) {
      const otherState = values.sq_other?.sq_other_action as
        | { value?: string }
        | undefined;
      const otherText = otherState?.value?.trim();
      return {
        message: question.message,
        answer: otherText || "Other",
      };
    }

    if (selectedValue) {
      return {
        message: question.message,
        answer: selectedValue,
      };
    }

    return null;
  }

  const textState = values.sq_text?.sq_text_action as
    | { value?: string }
    | undefined;
  const textValue = textState?.value?.trim();

  if (textValue) {
    return {
      message: question.message,
      answer: textValue,
    };
  }

  return null;
}

function mergeAnswers(existing: SummaryAnswer[], additions: SummaryAnswer[]): SummaryAnswer[] {
  const merged = new Map(existing.map((a) => [a.message, a.answer]));
  for (const a of additions) {
    merged.set(a.message, a.answer);
  }
  return [...merged.entries()].map(([message, answer]) => ({ message, answer }));
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
