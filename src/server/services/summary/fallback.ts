import { EntrySource } from "@prisma/client";
import type { SummaryLogEntry, SummaryPeriod, SummaryGenerationResult } from "./types";
import { dedupeOrderedLines, truncateLine, looksInProgress, LOW_SIGNAL_TASK_PATTERN } from "./task-processing";

export function buildFallbackSummary(input: {
  updateNo: number;
  period: SummaryPeriod;
  entries: SummaryLogEntry[];
  blockers: SummaryLogEntry[];
}): SummaryGenerationResult {
  const completed: string[] = [];
  const inProgress: string[] = [];

  for (const entry of input.entries) {
    if (entry.source === EntrySource.github_commit || entry.source === EntrySource.github_pr) {
      completed.push(entry.title ?? entry.content);
      continue;
    }

    if (entry.entryType === "blocker") {
      continue;
    }

    if (LOW_SIGNAL_TASK_PATTERN.test(entry.content.trim())) {
      continue;
    }

    if (looksInProgress(entry.content)) {
      inProgress.push(entry.content);
    } else {
      completed.push(entry.content);
    }
  }

  const workLabel = input.period === "week" ? "This week's work:" : "Today's work:";
  const blockerLines = dedupeOrderedLines(input.blockers.map((entry) => truncateLine(entry.content)));
  const completedLines = dedupeOrderedLines(completed.map((line) => truncateLine(line)));
  const inProgressLines = dedupeOrderedLines(inProgress.map((line) => truncateLine(line)));

  const lines = [`Update #${input.updateNo}`, "", workLabel];
  for (const line of completedLines.length ? completedLines : ["No completed work logged."]) {
    lines.push(`- ${line}`);
  }

  if (inProgressLines.length) {
    lines.push("", "In progress:");
    for (const line of inProgressLines) {
      lines.push(`- ${line}`);
    }
  }

  if (blockerLines.length) {
    lines.push("", "Blockers:");
    for (const line of blockerLines) {
      lines.push(`- ${line}`);
    }
  }

  return {
    summary: lines.join("\n"),
    questions: [],
    requestCommits: [],
    mode: "fallback",
  };
}
