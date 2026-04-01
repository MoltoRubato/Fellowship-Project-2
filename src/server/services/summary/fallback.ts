import { EntrySource } from "@prisma/client";
import type { SummaryLogEntry, SummaryPeriod, SummaryGenerationResult } from "./types";
import { dedupeOrderedLines, truncateLine, looksInProgress, LOW_SIGNAL_TASK_PATTERN } from "./task-processing";

function truncateKeepingSlackLink(line: string, max = 100) {
  const linkMatch = line.match(/\s-\sLink$/i);
  if (!linkMatch) {
    return truncateLine(line, max);
  }

  const linkSuffix = linkMatch[0];
  const textPart = line.slice(0, -linkSuffix.length).trimEnd();
  const maxTextLength = Math.max(20, max - linkSuffix.length - 1);
  return `${truncateLine(textPart, maxTextLength)}${linkSuffix}`;
}

function appendLink(line: string, url?: string | null) {
  if (!url) {
    return line;
  }
  return `${line} - Link`;
}

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
      completed.push(appendLink(entry.title ?? entry.content, entry.externalUrl));
      continue;
    }

    if (entry.entryType === "blocker") {
      continue;
    }

    if (LOW_SIGNAL_TASK_PATTERN.test(entry.content.trim())) {
      continue;
    }

    const lineWithLink = appendLink(entry.content, entry.source === EntrySource.linear_issue ? entry.externalUrl : null);

    if (looksInProgress(entry.content)) {
      inProgress.push(lineWithLink);
    } else {
      completed.push(lineWithLink);
    }
  }

  const workLabel = input.period === "week" ? "This week's work:" : "Today's work:";
  const blockerLines = dedupeOrderedLines(input.blockers.map((entry) => truncateLine(entry.content)));
  const completedLines = dedupeOrderedLines(completed.map((line) => truncateKeepingSlackLink(line)));
  const inProgressLines = dedupeOrderedLines(inProgress.map((line) => truncateKeepingSlackLink(line)));

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
