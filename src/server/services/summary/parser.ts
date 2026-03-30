import { parse as parseYaml } from "yaml";
import type { ParsedSummaryResponse, SummaryQuestion } from "./types";

function cleanYamlPayload(text: string) {
  return text
    .replace(/^```yaml\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normaliseQuestionOptions(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .map((option) => String(option ?? "").trim())
    .filter(Boolean);
}

export function parseSummaryResponse(text: string): ParsedSummaryResponse {
  const parsed = parseYaml(cleanYamlPayload(text)) as {
    summary?: unknown;
    questions?: unknown;
    request_commits?: unknown;
  };

  const questions = Array.isArray(parsed?.questions)
    ? parsed.questions
        .map((question) => {
          const candidate = question as { message?: unknown; options?: unknown };
          const message = String(candidate?.message ?? "").trim();
          if (!message) {
            return null;
          }

          return {
            message,
            options: normaliseQuestionOptions(candidate?.options),
          };
        })
        .filter((question): question is SummaryQuestion => Boolean(question))
    : [];

  const requestCommits = Array.isArray(parsed?.request_commits)
    ? parsed.request_commits.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];

  const summaryValue = typeof parsed?.summary === "string" ? parsed.summary.trim() : null;

  return {
    summary: summaryValue || null,
    questions,
    requestCommits,
    mode: "ai",
  };
}
