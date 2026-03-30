import { EntrySource } from "@prisma/client";
import type { SummaryLogEntry, TaskPromptItem, CommitPromptItem } from "./types";
import type { GithubCommitDetail } from "@/server/services/integrations/github";

const IN_PROGRESS_KEYWORDS = [
  "in progress",
  "wip",
  "ongoing",
  "pending",
  "waiting",
  "blocked",
  "need",
  "follow up",
  "todo",
];
const LOW_SIGNAL_TASK_PATTERN = /^(hi|hello|hey|yo|sup|test|testing)$/i;
const COMPLETED_HINT_PATTERN =
  /\b(done|finished|completed|fixed|added|implemented|shipped|merged|resolved|polished|reviewed)\b/i;

export function looksInProgress(text: string) {
  const lower = text.toLowerCase();
  return IN_PROGRESS_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function getTaskStatusHint(text: string): TaskPromptItem["status_hint"] {
  if (COMPLETED_HINT_PATTERN.test(text)) {
    return "completed";
  }

  if (looksInProgress(text)) {
    return "in_progress";
  }

  return "unknown";
}

export function dedupeOrderedLines(lines: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

export function truncateLine(text: string, max = 100) {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, max - 3))}...`;
}

export { LOW_SIGNAL_TASK_PATTERN };

export function parseCommitEntry(entry: SummaryLogEntry) {
  if (entry.source !== EntrySource.github_commit || !entry.externalId) {
    return null;
  }

  const prefix = "github-commit:";
  if (!entry.externalId.startsWith(prefix)) {
    return null;
  }

  const raw = entry.externalId.slice(prefix.length);
  const separatorIndex = raw.lastIndexOf(":");
  if (separatorIndex === -1) {
    return null;
  }

  const repo = raw.slice(0, separatorIndex);
  const sha = raw.slice(separatorIndex + 1);
  if (!repo || !sha) {
    return null;
  }

  return {
    repo,
    sha,
    message: entry.title ?? entry.content,
    createdAt: entry.createdAt,
  };
}

export function buildCommitPromptItems(commitDetails: GithubCommitDetail[]): CommitPromptItem[] {
  return commitDetails
    .slice()
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    .map((commit) => ({
      commit_message: commit.message,
      authors: commit.authors,
      commit_id: commit.sha,
    }));
}

export function buildTaskItems(entries: SummaryLogEntry[]) {
  const seen = new Set<string>();
  const tasks: TaskPromptItem[] = [];

  for (const entry of entries) {
    if (entry.source === EntrySource.github_commit || entry.entryType === "blocker") {
      continue;
    }

    const task =
      entry.source === EntrySource.github_pr
        ? `GitHub PR: ${entry.title ?? entry.content}`
        : entry.source === EntrySource.linear_issue
          ? `Linear: ${entry.title ?? entry.content}`
          : entry.content;

    if (LOW_SIGNAL_TASK_PATTERN.test(task.trim())) {
      continue;
    }

    const key = task.trim().toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    tasks.push({
      task,
      status_hint: getTaskStatusHint(task),
      source:
        entry.source === EntrySource.dm
          ? "dm"
          : entry.source === EntrySource.github_pr
            ? "github_pr"
            : entry.source === EntrySource.linear_issue
              ? "linear_issue"
              : "manual",
    });
  }

  return tasks;
}

export function buildBlockerItems(blockers: SummaryLogEntry[]) {
  return dedupeOrderedLines(
    blockers
      .slice()
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((entry) => entry.content),
  );
}
