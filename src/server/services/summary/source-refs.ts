import { EntrySource } from "@prisma/client";
import type { GithubCommitDetail } from "@/server/services/integrations/github";
import type { SummaryLogEntry } from "./types";

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return slug || "item";
}

function parseGithubCommitSha(externalId?: string | null) {
  if (!externalId?.startsWith("github-commit:")) {
    return null;
  }

  const raw = externalId.slice("github-commit:".length);
  const separator = raw.lastIndexOf(":");
  if (separator === -1) {
    return null;
  }

  return raw.slice(separator + 1).trim() || null;
}

function parseGithubCommitRepo(externalId?: string | null) {
  if (!externalId?.startsWith("github-commit:")) {
    return null;
  }

  const raw = externalId.slice("github-commit:".length);
  const separator = raw.lastIndexOf(":");
  if (separator === -1) {
    return null;
  }

  return raw.slice(0, separator).trim() || null;
}

function parseLinearIssueKey(externalId?: string | null) {
  if (!externalId?.startsWith("linear-issue:")) {
    return null;
  }

  const raw = externalId.slice("linear-issue:".length);
  const separator = raw.lastIndexOf(":");
  if (separator === -1) {
    return raw.trim() || null;
  }

  return raw.slice(0, separator).trim() || null;
}

function parsePullNumber(url?: string | null) {
  if (!url) {
    return null;
  }

  const match = url.match(/\/pull\/(\d+)(?:$|[/?#])/i);
  return match?.[1] ?? null;
}

function extractLinearTicket(title?: string | null, content?: string | null) {
  const match = `${title ?? ""} ${content ?? ""}`.match(/\b[A-Z]{2,}-\d+\b/);
  return match?.[0] ?? null;
}

export function getCommitSourceRef(commit: Pick<GithubCommitDetail, "repo" | "sha">) {
  return `commit_${slugify(`${commit.repo}_${commit.sha.slice(0, 12)}`)}`;
}

export function getEntrySourceRef(
  entry: Pick<SummaryLogEntry, "source" | "externalId" | "externalUrl" | "title" | "content">,
) {
  if (entry.source === EntrySource.github_commit) {
    const sha = parseGithubCommitSha(entry.externalId);
    const repo = parseGithubCommitRepo(entry.externalId);
    return sha && repo ? getCommitSourceRef({ repo, sha }) : null;
  }

  if (entry.source === EntrySource.github_pr) {
    const pullNumber = parsePullNumber(entry.externalUrl);
    return pullNumber ? `pr_${slugify(pullNumber)}` : null;
  }

  if (entry.source === EntrySource.linear_issue) {
    const issueKey = parseLinearIssueKey(entry.externalId) ?? extractLinearTicket(entry.title, entry.content);
    return issueKey ? `linear_${slugify(issueKey)}` : null;
  }

  return null;
}
