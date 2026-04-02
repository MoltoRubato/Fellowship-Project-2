import { EntrySource } from "@prisma/client";
import type { SummaryLogEntry, SummaryPeriod, SummaryGenerationResult } from "./types";
import {
  dedupeOrderedLines,
  truncateLine,
  looksInProgress,
  LOW_SIGNAL_TASK_PATTERN,
  buildLinearTaskText,
  extractTicketIdentifier,
  normalizeTicketTitle,
} from "./task-processing";
import { getEntrySourceRef } from "./source-refs";

type FallbackItem = {
  text: string;
  ref: string | null;
  url: string | null;
  source: SummaryLogEntry["source"];
  inProgress: boolean;
  createdAt: number;
};

type FallbackGroup = {
  key: string;
  title: string;
  titleRef: string | null;
  titleUrl: string | null;
  items: FallbackItem[];
  sortAt: number;
};

const LINEAR_COMPLETED_STATE_PATTERN = /\bmoved to (done|completed|closed|canceled|cancelled)\b/i;
const LINEAR_IN_PROGRESS_STATE_PATTERN = /\bmoved to (in progress|doing|in review|review|backlog|todo|planned)\b/i;

function getSummaryHeader(period: SummaryPeriod) {
  return period === "week" ? "Weekly update :male-technologist::" : "Daily update :male-technologist::";
}

function stripRepoPrefixedCommit(content: string) {
  return content.replace(/^Commit to .*?:\s*/i, "").trim();
}

function stripTicketPrefix(text: string, ticket: string | null) {
  if (!ticket) {
    return text.trim();
  }

  return text.replace(new RegExp(`^${ticket}\\s*[:\\-]?\\s*`, "i"), "").trim();
}

function normalizeGithubPrDetail(entry: SummaryLogEntry) {
  const contentMatch = entry.content.match(/^PR\s+(.+?)\s+in\s+[^:]+:\s*(.+)$/i);
  if (contentMatch) {
    const action = contentMatch[1]?.trim() ?? "updated";
    const title = contentMatch[2]?.trim() ?? entry.title ?? "";
    const normalizedTitle = title || entry.title || entry.content;
    return truncateLine(`PR ${action}: ${normalizedTitle}`);
  }

  return truncateLine(entry.title ?? entry.content);
}

function normalizeLinearDetail(entry: SummaryLogEntry, ticket: string | null) {
  const content = stripTicketPrefix(entry.content, ticket);
  if (!content) {
    return "Updated Linear issue";
  }

  if (LINEAR_COMPLETED_STATE_PATTERN.test(content) || LINEAR_IN_PROGRESS_STATE_PATTERN.test(content)) {
    return truncateLine(content.charAt(0).toUpperCase() + content.slice(1));
  }

  return truncateLine(content);
}

function normalizeUnticketedGithubText(text: string, repo?: string | null) {
  if (!repo) {
    return truncateLine(text);
  }

  return truncateLine(`[${repo}] ${text}`);
}

function buildFallbackItem(entry: SummaryLogEntry, hasMultipleRepos: boolean) {
  const ticket = extractTicketIdentifier(entry.title ?? null, entry.content);
  const ref = getEntrySourceRef(entry);
  const repo = entry.project?.githubRepo ?? null;
  const repoPrefixNeeded = hasMultipleRepos && !ticket;
  let text = "";

  if (entry.source === EntrySource.github_commit) {
    text = stripRepoPrefixedCommit(entry.title ?? entry.content);
  } else if (entry.source === EntrySource.github_pr) {
    text = normalizeGithubPrDetail(entry);
  } else if (entry.source === EntrySource.linear_issue) {
    text = normalizeLinearDetail(entry, ticket);
  } else {
    text = truncateLine(entry.content);
  }

  const normalizedText =
    repoPrefixNeeded && (entry.source === EntrySource.github_commit || entry.source === EntrySource.github_pr)
      ? normalizeUnticketedGithubText(text, repo)
      : truncateLine(text);

  return {
    text: normalizedText,
    ref,
    url: entry.externalUrl ?? null,
    source: entry.source,
    inProgress:
      entry.source === EntrySource.linear_issue
        ? LINEAR_IN_PROGRESS_STATE_PATTERN.test(entry.content)
        : looksInProgress(entry.content) || looksInProgress(normalizedText),
    createdAt: entry.createdAt.getTime(),
  };
}

function pickGroupTitle(entry: SummaryLogEntry, ticket: string | null) {
  if (!ticket) {
    return "Other";
  }

  if (entry.source === EntrySource.linear_issue && entry.title?.trim()) {
    return normalizeTicketTitle(ticket, entry.title);
  }

  if (entry.source === EntrySource.github_pr && entry.title?.trim()) {
    return normalizeTicketTitle(ticket, entry.title);
  }

  return ticket;
}

function getTitlePriority(entry: SummaryLogEntry) {
  if (entry.source === EntrySource.linear_issue) {
    return 3;
  }

  if (entry.source === EntrySource.github_pr) {
    return 2;
  }

  if (entry.source === EntrySource.manual || entry.source === EntrySource.dm) {
    return 1;
  }

  return 0;
}

function dedupeGroupItems(items: FallbackItem[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = `${item.text.toLowerCase()}|${item.ref ?? ""}|${item.url ?? ""}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function formatBulletText(item: FallbackItem) {
  if (!item.ref) {
    return item.text;
  }

  return `${item.text} [ref:${item.ref}]`;
}

export function buildFallbackSummary(input: {
  updateNo: number;
  period: SummaryPeriod;
  entries: SummaryLogEntry[];
  blockers: SummaryLogEntry[];
}): SummaryGenerationResult {
  const groups = new Map<string, FallbackGroup & { titlePriority: number }>();
  const scopedEntries = input.entries.filter((entry) => {
    if (entry.entryType === "blocker") {
      return false;
    }

    const candidateText = entry.source === EntrySource.linear_issue
      ? buildLinearTaskText(entry)
      : entry.title ?? entry.content;

    return !LOW_SIGNAL_TASK_PATTERN.test(candidateText.trim());
  });
  const repoCount = new Set(
    scopedEntries
      .map((entry) => entry.project?.githubRepo ?? null)
      .filter((repo): repo is string => Boolean(repo)),
  ).size;
  const hasMultipleRepos = repoCount > 1;

  for (const entry of scopedEntries) {
    const ticket = extractTicketIdentifier(entry.title ?? null, entry.content);
    const key = ticket ? `ticket:${ticket}` : "other";
    const existing = groups.get(key);
    const title = pickGroupTitle(entry, ticket);
    const titlePriority = getTitlePriority(entry);
    const candidateTitleRef =
      entry.source === EntrySource.linear_issue || entry.source === EntrySource.github_pr
        ? getEntrySourceRef(entry)
        : null;
    const candidateTitleUrl =
      entry.source === EntrySource.linear_issue || entry.source === EntrySource.github_pr
        ? (entry.externalUrl ?? null)
        : null;

    if (!existing) {
      groups.set(key, {
        key,
        title,
        titleRef: candidateTitleRef,
        titleUrl: candidateTitleUrl,
        items: [buildFallbackItem(entry, hasMultipleRepos)],
        sortAt: entry.createdAt.getTime(),
        titlePriority,
      });
      continue;
    }

    existing.items.push(buildFallbackItem(entry, hasMultipleRepos));
    existing.sortAt = Math.min(existing.sortAt, entry.createdAt.getTime());

    if (titlePriority > existing.titlePriority) {
      existing.title = title;
      existing.titlePriority = titlePriority;
      existing.titleRef = candidateTitleRef;
      existing.titleUrl = candidateTitleUrl;
    } else if (!existing.titleRef && candidateTitleRef) {
      existing.titleRef = candidateTitleRef;
      existing.titleUrl = candidateTitleUrl;
    }
  }

  const orderedGroups = [...groups.values()]
    .map((group) => ({
      ...group,
      items: dedupeGroupItems(group.items).sort((left, right) => left.createdAt - right.createdAt),
    }))
    .filter((group) => group.items.length)
    .sort((left, right) => left.sortAt - right.sortAt);

  const nextUpLines = dedupeOrderedLines(
    orderedGroups.flatMap((group) => {
      const inProgressItems = group.items.filter((item) => item.inProgress);
      if (!inProgressItems.length) {
        return [];
      }

      if (group.key !== "other") {
        return [group.title];
      }

      return inProgressItems.map((item) => item.text);
    }),
  ).map((line) => truncateLine(line));

  const blockerLines = dedupeOrderedLines(input.blockers.map((entry) => truncateLine(entry.content)));

  const lines = [getSummaryHeader(input.period), ""];

  if (!orderedGroups.length) {
    lines.push("- Other");
    lines.push("  - No updates logged.");
  } else {
    for (const group of orderedGroups) {
      const titleLine = group.titleRef ? `${group.title} [ref:${group.titleRef}]` : group.title;
      lines.push(`- ${titleLine}`);

      for (const item of group.items) {
        lines.push(`  - ${formatBulletText(item)}`);
      }
    }
  }

  if (nextUpLines.length) {
    lines.push("", "Next up:");
    for (const line of nextUpLines) {
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
