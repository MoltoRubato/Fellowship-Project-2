import type { SummaryAnswer, SummaryQuestion } from "@/server/services/summary";

const PLACEHOLDER_OPTION_PATTERN = /\b(?:x|n)\b(?=[%\s/~:-]|$)|please specify/i;

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeComparableText(value: string) {
  return normalizeWhitespace(
    value
      .toLowerCase()
      .replace(/[`*_~"]/g, " ")
      .replace(/[^a-z0-9\s]/g, " "),
  );
}

export function normalizeSummaryQuestionMessage(message: string) {
  return normalizeComparableText(message);
}

export function sanitizeSummaryQuestionOptions(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  const seen = new Set<string>();

  return value
    .map((option) => String(option ?? "").trim())
    .filter(Boolean)
    .filter((option) => !PLACEHOLDER_OPTION_PATTERN.test(option))
    .filter((option) => {
      const normalized = normalizeComparableText(option);
      if (!normalized || seen.has(normalized)) {
        return false;
      }

      seen.add(normalized);
      return true;
    });
}

export function dedupeSummaryQuestions(questions: SummaryQuestion[]) {
  const seen = new Set<string>();

  return questions.filter((question) => {
    const normalized = normalizeSummaryQuestionMessage(question.message);
    if (!normalized || seen.has(normalized)) {
      return false;
    }

    seen.add(normalized);
    return true;
  });
}

export function filterUnansweredSummaryQuestions(
  questions: SummaryQuestion[],
  answers: SummaryAnswer[],
) {
  const answeredMessages = new Set(
    answers
      .map((answer) => normalizeSummaryQuestionMessage(answer.message))
      .filter(Boolean),
  );

  return dedupeSummaryQuestions(questions).filter(
    (question) => !answeredMessages.has(normalizeSummaryQuestionMessage(question.message)),
  );
}
