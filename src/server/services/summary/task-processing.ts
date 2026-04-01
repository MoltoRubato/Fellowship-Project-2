import { EntrySource } from "@prisma/client";
import type { SummaryLogEntry, TaskPromptItem, CommitPromptItem } from "./types";
import type { GithubCommitDetail } from "@/server/services/integrations/github";
import { getCommitSourceRef, getEntrySourceRef } from "./source-refs";

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
  /\b(done|finished|completed|fixed|added|implemented|shipped|merged|resolved|polished|reviewed|closed)\b/i;
const LINEAR_COMPLETED_STATE_PATTERN = /\bmoved to (done|completed|closed|canceled|cancelled)\b/i;
const LINEAR_IN_PROGRESS_STATE_PATTERN = /\bmoved to (in progress|doing|in review|review|backlog|todo|planned)\b/i;

function extractLinearIdentifier(value?: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(/\b[A-Z]{2,}-\d+\b/);
  return match?.[0] ?? null;
}

function stripLeadingLinearIdentifier(value: string, identifier?: string | null) {
  if (!identifier) {
    return value.trim();
  }

  return value.replace(new RegExp(`^${identifier}\\s+`, "i"), "").trim();
}

export function buildLinearTaskText(entry: SummaryLogEntry) {
  const title = entry.title?.trim() ?? "";
  const content = entry.content.trim();
  const identifier = extractLinearIdentifier(title) ?? extractLinearIdentifier(content);
  const cleanTitle = stripLeadingLinearIdentifier(title, identifier);
  const cleanContent = stripLeadingLinearIdentifier(content, identifier);

  if (cleanTitle && cleanContent) {
    if (cleanTitle.toLowerCase() === cleanContent.toLowerCase()) {
      return `Linear: ${identifier ? `${identifier} ` : ""}${cleanTitle}`.trim();
    }

    return `Linear: ${identifier ? `${identifier} ` : ""}${cleanTitle} - ${cleanContent}`.trim();
  }

  if (cleanTitle) {
    return `Linear: ${identifier ? `${identifier} ` : ""}${cleanTitle}`.trim();
  }

  if (cleanContent) {
    return `Linear: ${identifier ? `${identifier} ` : ""}${cleanContent}`.trim();
  }

  return "Linear update";
}

export function looksInProgress(text: string) {
  const lower = text.toLowerCase();
  return IN_PROGRESS_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function getTaskStatusHint(entry: SummaryLogEntry, taskText: string): TaskPromptItem["status_hint"] {
  const statusText = [entry.content, entry.title ?? "", taskText].join(" ").trim();

  if (entry.source === EntrySource.linear_issue) {
    if (LINEAR_COMPLETED_STATE_PATTERN.test(statusText)) {
      return "completed";
    }

    if (LINEAR_IN_PROGRESS_STATE_PATTERN.test(statusText)) {
      return "in_progress";
    }
  }

  if (COMPLETED_HINT_PATTERN.test(statusText)) {
    return "completed";
  }

  if (looksInProgress(statusText)) {
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
      commit_url: `https://github.com/${commit.repo}/commit/${commit.sha}`,
      source_ref: getCommitSourceRef(commit),
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
          ? buildLinearTaskText(entry)
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
      status_hint: getTaskStatusHint(entry, task),
      source:
        entry.source === EntrySource.dm
          ? "dm"
          : entry.source === EntrySource.github_pr
            ? "github_pr"
            : entry.source === EntrySource.linear_issue
              ? "linear_issue"
              : "manual",
      link:
        entry.source === EntrySource.github_pr || entry.source === EntrySource.linear_issue
          ? (entry.externalUrl ?? null)
          : null,
      source_ref: getEntrySourceRef(entry),
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
