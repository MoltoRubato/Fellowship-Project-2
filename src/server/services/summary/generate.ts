import type { SummaryLogEntry, SummaryPeriod, SummaryAnswer } from "./types";
import { fetchGithubCommitDetails } from "@/server/services/integrations/github";
import {
  parseCommitEntry,
  buildCommitPromptItems,
  buildTaskItems,
  buildBlockerItems,
  extractTicketIdentifier,
} from "./task-processing";
import { runAiSummary } from "./ai";
import { buildFallbackSummary } from "./fallback";
import {
  hasStructuredNonOtherGroup,
  isStructuredTicketSummary,
  renderSummaryForSlack,
} from "./slack-format";
import {
  containsSummaryPlaceholderValue,
  stripPlaceholderPhrases,
} from "@/lib/summary-placeholders";

function sanitizeSummaryPlaceholders(summary: string) {
  return summary
    .split("\n")
    .map((line) => {
      const match = line.match(/^(\s*(?:[-•]\s+|\d+[.)]\s+))(.*)$/);
      if (!match) {
        return line;
      }

      const [, prefix, content] = match;
      if (!containsSummaryPlaceholderValue(content)) {
        return line;
      }

      const sanitizedContent = stripPlaceholderPhrases(content);
      return sanitizedContent ? `${prefix}${sanitizedContent}` : "";
    })
    .filter((line, index, lines) => {
      if (line) {
        return true;
      }

      const prev = lines[index - 1];
      const next = lines[index + 1];
      return Boolean(prev && next);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function hasGroupableWork(entries: SummaryLogEntry[]) {
  return entries.some((entry) => {
    if (entry.source === "github_pr" || entry.source === "linear_issue") {
      return true;
    }

    return Boolean(extractTicketIdentifier(entry.title ?? null, entry.content));
  });
}

export function getSummaryWindow(period: SummaryPeriod) {
  if (period === "week") {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    now.setDate(now.getDate() + diff);
    return now;
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

export async function generateStandupSummary(input: {
  userId: string;
  period: SummaryPeriod;
  updateNo: number;
  entries: SummaryLogEntry[];
  blockers: SummaryLogEntry[];
  answers?: SummaryAnswer[];
}) {
  const commitLookups = input.entries
    .map((entry) => parseCommitEntry(entry))
    .filter((entry): entry is NonNullable<ReturnType<typeof parseCommitEntry>> => Boolean(entry));
  const commitDetails = await fetchGithubCommitDetails(input.userId, commitLookups);
  const blockers = buildBlockerItems(input.blockers);
  const commits = buildCommitPromptItems(commitDetails);
  const tasks = buildTaskItems(input.entries);

  const aiResult = await runAiSummary({
    userId: input.userId,
    period: input.period,
    updateNo: input.updateNo,
    blockers,
    commits,
    tasks,
    commitDetails,
    answers: input.answers ?? [],
  });

  if (aiResult?.summary) {
    const sanitizedSummary = sanitizeSummaryPlaceholders(aiResult.summary);
    const shouldFallback =
      !isStructuredTicketSummary(sanitizedSummary) ||
      (hasGroupableWork(input.entries) && !hasStructuredNonOtherGroup(sanitizedSummary));

    if (shouldFallback) {
      const fallback = buildFallbackSummary({
        updateNo: input.updateNo,
        period: input.period,
        entries: input.entries,
        blockers: input.blockers,
      });

      if (fallback.summary) {
        return {
          ...fallback,
          summary: renderSummaryForSlack(
            sanitizeSummaryPlaceholders(fallback.summary),
            input.entries,
          ),
        };
      }
    }

    return {
      ...aiResult,
      summary: renderSummaryForSlack(
        sanitizedSummary,
        input.entries,
      ),
    };
  }

  const fallback = buildFallbackSummary({
    updateNo: input.updateNo,
    period: input.period,
    entries: input.entries,
    blockers: input.blockers,
  });

  if (!fallback.summary) {
    return aiResult
      ? {
          ...aiResult,
          questions: [],
          requestCommits: [],
        }
      : fallback;
  }

  return {
    ...fallback,
    summary: renderSummaryForSlack(
      sanitizeSummaryPlaceholders(fallback.summary),
      input.entries,
    ),
  };
}
