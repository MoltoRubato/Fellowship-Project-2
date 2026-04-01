import type { SummaryAnswer, SummaryQuestion } from "@/server/services/summary";
import { normalizeOptionToPlaceholders } from "@/lib/summary-placeholders";

const LOW_SIGNAL_TOKENS = new Set([
  "a",
  "an",
  "any",
  "are",
  "as",
  "at",
  "by",
  "did",
  "do",
  "for",
  "from",
  "how",
  "in",
  "is",
  "made",
  "of",
  "on",
  "or",
  "the",
  "to",
  "was",
  "were",
  "what",
]);

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

function isUiProvidedOtherOption(option: string) {
  const normalized = normalizeComparableText(option);
  return normalized === "other" || normalized === "custom" || normalized === "something else";
}

function tokenizeComparableText(value: string) {
  return normalizeComparableText(value)
    .split(" ")
    .filter((token) => token && !LOW_SIGNAL_TOKENS.has(token));
}

function areQuestionMessagesEquivalent(a: string, b: string) {
  const normalizedA = normalizeSummaryQuestionMessage(a);
  const normalizedB = normalizeSummaryQuestionMessage(b);

  if (!normalizedA || !normalizedB) {
    return false;
  }

  if (normalizedA === normalizedB) {
    return true;
  }

  const tokensA = new Set(tokenizeComparableText(a));
  const tokensB = new Set(tokenizeComparableText(b));

  if (!tokensA.size || !tokensB.size) {
    return false;
  }

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      overlap += 1;
    }
  }

  const overlapRatio = overlap / Math.max(tokensA.size, tokensB.size);
  return overlapRatio >= 0.75;
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
    .map((option) => normalizeOptionToPlaceholders(option))
    .filter((option) => !isUiProvidedOtherOption(option))
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
  const seen: SummaryQuestion[] = [];

  return questions.filter((question) => {
    const normalized = normalizeSummaryQuestionMessage(question.message);
    if (!normalized) {
      return false;
    }

    if (seen.some((candidate) => areQuestionMessagesEquivalent(candidate.message, question.message))) {
      return false;
    }

    seen.push(question);
    return true;
  });
}

export function filterUnansweredSummaryQuestions(
  questions: SummaryQuestion[],
  answers: SummaryAnswer[],
) {
  const answeredMessages = answers
    .map((answer) => answer.message)
    .filter(Boolean);

  return dedupeSummaryQuestions(questions).filter(
    (question) => !answeredMessages.some((message) => areQuestionMessagesEquivalent(message, question.message)),
  );
}
