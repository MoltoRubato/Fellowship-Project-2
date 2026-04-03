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

type GroupSeed = {
  key: string;
  title: string;
  titleRef: string | null;
  titleUrl: string | null;
  titlePriority: number;
};

const LINEAR_COMPLETED_STATE_PATTERN = /\bmoved to (done|completed|closed|canceled|cancelled)\b/i;
const LINEAR_IN_PROGRESS_STATE_PATTERN = /\bmoved to (in progress|doing|in review|review|backlog|todo|planned)\b/i;
const GROUP_MATCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

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

function buildUnticketedGithubPrTitle(entry: SummaryLogEntry) {
  const contentMatch = entry.content.match(/^PR\s+.+?\s+in\s+[^:]+:\s*(.+)$/i);
  return truncateLine(contentMatch?.[1]?.trim() || entry.title || entry.content);
}

function buildUnticketedLinearTitle(entry: SummaryLogEntry) {
  const title = entry.title?.trim();
  if (title) {
    return truncateLine(title);
  }

  const taskText = buildLinearTaskText(entry).replace(/^Linear:\s*/i, "").trim();
  return truncateLine(taskText || entry.content);
}

function normalizeMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[`*_~[\]()]/g, " ")
    .replace(/[^a-z0-9\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singularizeToken(token: string) {
  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.endsWith("ing") && token.length > 5) {
    return token.slice(0, -3);
  }

  if (token.endsWith("ed") && token.length > 4) {
    return token.slice(0, -2);
  }

  if (token.endsWith("es") && token.length > 4) {
    return token.slice(0, -2);
  }

  if (token.endsWith("s") && token.length > 3) {
    return token.slice(0, -1);
  }

  return token;
}

function tokenizeMatchText(value: string) {
  return normalizeMatchText(value)
    .split(" ")
    .map((token) => singularizeToken(token))
    .filter((token) => token.length >= 2 && !GROUP_MATCH_STOP_WORDS.has(token));
}

function scoreTitleSimilarity(left: string, right: string) {
  const normalizedLeft = normalizeMatchText(left);
  const normalizedRight = normalizeMatchText(right);

  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return 0.9;
  }

  const leftTokens = new Set(tokenizeMatchText(left));
  const rightTokens = new Set(tokenizeMatchText(right));

  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  if (!overlap) {
    return 0;
  }

  const coverage = overlap / rightTokens.size;
  const precision = overlap / leftTokens.size;
  return coverage * 0.75 + precision * 0.25;
}

function buildEntryMatchTexts(entry: SummaryLogEntry) {
  if (entry.source === EntrySource.github_commit) {
    const title = stripRepoPrefixedCommit(entry.title ?? entry.content);
    return [title, entry.title ?? entry.content].filter(Boolean);
  }

  if (entry.source === EntrySource.github_pr) {
    return [
      buildUnticketedGithubPrTitle(entry),
      normalizeGithubPrDetail(entry),
      entry.title ?? entry.content,
    ].filter(Boolean);
  }

  if (entry.source === EntrySource.linear_issue) {
    return [
      buildUnticketedLinearTitle(entry),
      buildLinearTaskText(entry),
      entry.content,
    ].filter(Boolean);
  }

  return [entry.content].filter(Boolean);
}

function findBestRepoGroupKey(
  entry: SummaryLogEntry,
  candidateKeys: string[],
  groups: Map<string, FallbackGroup & { titlePriority: number }>,
) {
  let bestKey: string | null = null;
  let bestScore = 0;
  let secondBestScore = 0;
  const texts = buildEntryMatchTexts(entry);

  for (const key of candidateKeys) {
    const group = groups.get(key);
    if (!group) {
      continue;
    }

    const score = texts.reduce((maxScore, text) => Math.max(maxScore, scoreTitleSimilarity(text, group.title)), 0);
    if (score > bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestKey = key;
      continue;
    }

    if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  if (!bestKey || bestScore < 0.4) {
    return null;
  }

  if (bestScore - secondBestScore < 0.08 && bestScore < 0.85) {
    return null;
  }

  return bestKey;
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

function getGroupSeed(entry: SummaryLogEntry): GroupSeed | null {
  const ticket = extractTicketIdentifier(entry.title ?? null, entry.content);
  const titlePriority = getTitlePriority(entry);

  if (ticket) {
    return {
      key: `ticket:${ticket}`,
      title: pickGroupTitle(entry, ticket),
      titleRef:
        entry.source === EntrySource.linear_issue || entry.source === EntrySource.github_pr
          ? getEntrySourceRef(entry)
          : null,
      titleUrl:
        entry.source === EntrySource.linear_issue || entry.source === EntrySource.github_pr
          ? (entry.externalUrl ?? null)
          : null,
      titlePriority,
    };
  }

  if (entry.source === EntrySource.linear_issue) {
    return {
      key: `linear:${entry.externalId ?? entry.externalUrl ?? entry.title ?? entry.content}`,
      title: buildUnticketedLinearTitle(entry),
      titleRef: getEntrySourceRef(entry),
      titleUrl: entry.externalUrl ?? null,
      titlePriority,
    };
  }

  if (entry.source === EntrySource.github_pr) {
    return {
      key: `pr:${entry.externalUrl ?? entry.externalId ?? entry.title ?? entry.content}`,
      title: buildUnticketedGithubPrTitle(entry),
      titleRef: getEntrySourceRef(entry),
      titleUrl: entry.externalUrl ?? null,
      titlePriority,
    };
  }

  return null;
}

function getAssignedGroupKey(
  entry: SummaryLogEntry,
  repoGroupKeys: Map<string, Set<string>>,
  groups: Map<string, FallbackGroup & { titlePriority: number }>,
) {
  const seed = getGroupSeed(entry);
  if (seed) {
    return seed.key;
  }

  const repo = entry.project?.githubRepo ?? null;
  if (repo) {
    const matchingKeys = [...(repoGroupKeys.get(repo) ?? new Set<string>())];
    if (matchingKeys.length === 1) {
      return matchingKeys[0] ?? "other";
    }

    const bestKey = findBestRepoGroupKey(entry, matchingKeys, groups);
    if (bestKey) {
      return bestKey;
    }
  }

  return "other";
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

function capitalizeWord(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : value;
}

function compressDuplicatePrText(item: FallbackItem, groupTitle: string) {
  if (item.source !== EntrySource.github_pr) {
    return item.text;
  }

  const match = item.text.match(/^PR\s+(.+?):\s+(.+)$/i);
  if (!match) {
    return item.text;
  }

  const [, action, rawTitle] = match;
  const ticket = extractTicketIdentifier(groupTitle, rawTitle);
  const normalizedTitle = normalizeMatchText(stripTicketPrefix(rawTitle, ticket));
  const normalizedGroupTitle = normalizeMatchText(stripTicketPrefix(groupTitle, ticket));

  if (
    normalizedTitle &&
    normalizedGroupTitle &&
    (normalizedTitle === normalizedGroupTitle ||
      normalizedTitle.includes(normalizedGroupTitle) ||
      normalizedGroupTitle.includes(normalizedTitle))
  ) {
    return `${capitalizeWord(action)} PR`;
  }

  return item.text;
}

function formatBulletText(item: FallbackItem, groupTitle: string) {
  const text = compressDuplicatePrText(item, groupTitle);
  if (!item.ref) {
    return text;
  }

  return `${text} [ref:${item.ref}]`;
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
  const repoGroupKeys = new Map<string, Set<string>>();

  for (const entry of scopedEntries) {
    const seed = getGroupSeed(entry);
    if (!seed) {
      continue;
    }

    const existing = groups.get(seed.key);
    const repo = entry.project?.githubRepo ?? null;

    if (repo) {
      const keys = repoGroupKeys.get(repo) ?? new Set<string>();
      keys.add(seed.key);
      repoGroupKeys.set(repo, keys);
    }

    if (!existing) {
      groups.set(seed.key, {
        key: seed.key,
        title: seed.title,
        titleRef: seed.titleRef,
        titleUrl: seed.titleUrl,
        items: [],
        sortAt: entry.createdAt.getTime(),
        titlePriority: seed.titlePriority,
      });
      continue;
    }
    existing.sortAt = Math.min(existing.sortAt, entry.createdAt.getTime());

    if (seed.titlePriority > existing.titlePriority) {
      existing.title = seed.title;
      existing.titlePriority = seed.titlePriority;
      existing.titleRef = seed.titleRef;
      existing.titleUrl = seed.titleUrl;
    } else if (!existing.titleRef && seed.titleRef) {
      existing.titleRef = seed.titleRef;
      existing.titleUrl = seed.titleUrl;
    }
  }

  for (const entry of scopedEntries) {
    const key = getAssignedGroupKey(entry, repoGroupKeys, groups);
    const existing = groups.get(key);
    const seed = getGroupSeed(entry);

    if (!existing) {
      groups.set(key, {
        key,
        title: seed?.title ?? "Other",
        titleRef: seed?.titleRef ?? null,
        titleUrl: seed?.titleUrl ?? null,
        items: [buildFallbackItem(entry, hasMultipleRepos)],
        sortAt: entry.createdAt.getTime(),
        titlePriority: seed?.titlePriority ?? 0,
      });
      continue;
    }

    existing.items.push(buildFallbackItem(entry, hasMultipleRepos));
    existing.sortAt = Math.min(existing.sortAt, entry.createdAt.getTime());

    if (seed && seed.titlePriority > existing.titlePriority) {
      existing.title = seed.title;
      existing.titlePriority = seed.titlePriority;
      existing.titleRef = seed.titleRef;
      existing.titleUrl = seed.titleUrl;
    } else if (seed?.titleRef && !existing.titleRef) {
      existing.titleRef = seed.titleRef;
      existing.titleUrl = seed.titleUrl;
    }
  }

  const orderedGroups = [...groups.values()]
    .map((group) => ({
      ...group,
      items: dedupeGroupItems(group.items).sort((left, right) => left.createdAt - right.createdAt),
    }))
    .filter((group) => group.items.length)
    .sort((left, right) => {
      if (left.key === "other" && right.key !== "other") {
        return 1;
      }

      if (right.key === "other" && left.key !== "other") {
        return -1;
      }

      return left.sortAt - right.sortAt;
    });

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
        lines.push(`  - ${formatBulletText(item, group.title)}`);
      }
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
