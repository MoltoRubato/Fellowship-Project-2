import type { App } from "@slack/bolt";
import type { SummaryAnswer, SummaryQuestion } from "@/server/services/summary";
import {
  ensureSlackUser,
  getUserContextBySlackId,
} from "@/server/services/standup";
import {
  completeSummarySession,
  expireSummarySession,
  getPendingSummarySession,
  updatePendingSummarySession,
} from "@/server/services/summarySessions";
import { generateSummaryResult } from "./generate-result";
import { sendQuestionsDM } from "./question-modal";

function parseSummaryAnswersFromMessage(text: string, questions: SummaryQuestion[]) {
  const trimmed = text.trim();
  if (!trimmed) {
    return [] as SummaryAnswer[];
  }

  if (questions.length === 1 && !/^\d+\s*[:.)-]/.test(trimmed)) {
    return [
      {
        message: questions[0].message,
        answer: trimmed,
      },
    ];
  }

  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  const numberedAnswers = new Map<number, string>();

  for (const line of lines) {
    const match = line.match(/^(\d+)\s*[:.)-]\s*(.+)$/);
    if (!match) {
      continue;
    }

    const index = Number(match[1]);
    const answer = match[2]?.trim();
    if (!Number.isInteger(index) || !answer) {
      continue;
    }

    numberedAnswers.set(index, answer);
  }

  if (numberedAnswers.size) {
    return questions
      .map((question, index) => {
        const answer = numberedAnswers.get(index + 1);
        return answer
          ? {
              message: question.message,
              answer,
            }
          : null;
      })
      .filter((answer): answer is SummaryAnswer => Boolean(answer));
  }

  if (lines.length === questions.length) {
    return questions.map((question, index) => ({
      message: question.message,
      answer: lines[index]!,
    }));
  }

  return [] as SummaryAnswer[];
}

function mergeSummaryAnswers(existing: SummaryAnswer[], additions: SummaryAnswer[]) {
  const merged = new Map(existing.map((answer) => [answer.message, answer.answer]));

  for (const answer of additions) {
    merged.set(answer.message, answer.answer);
  }

  return [...merged.entries()].map(([message, answer]) => ({
    message,
    answer,
  }));
}

export async function handlePendingSummarySessionReply(app: App, userId: string, teamId: string, text: string) {
  await ensureSlackUser(userId, teamId);
  const user = await getUserContextBySlackId(userId);
  if (!user) {
    return false;
  }

  const session = await getPendingSummarySession(user.id);
  if (!session) {
    return false;
  }

  const questions = Array.isArray(session.questions)
    ? (session.questions as unknown as SummaryQuestion[])
    : [];
  const existingAnswers = Array.isArray(session.answers)
    ? (session.answers as unknown as SummaryAnswer[])
    : [];
  const newAnswers = parseSummaryAnswersFromMessage(text, questions);

  if (!newAnswers.length) {
    await app.client.chat.postMessage({
      channel: userId,
      text: "I couldn't match that reply to the questions. Please use the button above to answer them.",
    });
    return true;
  }

  const mergedAnswers = mergeSummaryAnswers(existingAnswers, newAnswers);
  const unansweredQuestions = questions.filter(
    (question) => !mergedAnswers.some((answer) => answer.message === question.message),
  );

  if (unansweredQuestions.length) {
    await updatePendingSummarySession(session.id, {
      summaryPreview: session.summaryPreview,
      questions: unansweredQuestions,
      answers: mergedAnswers,
    });

    await sendQuestionsDM(
      app.client,
      userId,
      session.id,
      session.updateNo,
      session.project?.githubRepo ?? null,
      session.summaryPreview,
      unansweredQuestions,
    );
    return true;
  }

  const resolved = await generateSummaryResult({
    slackUserId: userId,
    slackTeamId: teamId,
    period: session.period === "week" ? "week" : "today",
    repo: session.project?.githubRepo ?? null,
    updateNo: session.updateNo,
    answers: mergedAnswers,
  });

  if (!resolved.ok) {
    await expireSummarySession(session.id);
    await app.client.chat.postMessage({
      channel: userId,
      text: resolved.text,
    });
    return true;
  }

  if (resolved.summaryResult.questions.length) {
    await updatePendingSummarySession(session.id, {
      summaryPreview: resolved.summaryResult.summary,
      questions: resolved.summaryResult.questions,
      answers: mergedAnswers,
    });

    await sendQuestionsDM(
      app.client,
      userId,
      session.id,
      resolved.updateNo,
      session.project?.githubRepo ?? null,
      resolved.summaryResult.summary,
      resolved.summaryResult.questions,
    );
    return true;
  }

  await completeSummarySession(session.id);

  if (resolved.summaryResult.summary) {
    await app.client.chat.postMessage({
      channel: session.channelId,
      text: resolved.summaryResult.summary,
    });
  }

  await app.client.chat.postMessage({
    channel: userId,
    text: `Posted Update #${resolved.updateNo}${session.project?.githubRepo ? ` for ${session.project.githubRepo}` : ""}.`,
  });
  return true;
}
