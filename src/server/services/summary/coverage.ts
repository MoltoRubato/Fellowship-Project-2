import type { SummaryLogEntry, SummaryPeriod } from "./types";
import { truncateLine } from "./task-processing";

const LINEAR_COMPLETED_STATE_PATTERN = /\bmoved to (done|completed|closed|canceled|cancelled)\b/i;
const LINEAR_IN_PROGRESS_STATE_PATTERN = /\bmoved to (in progress|doing|in review|review|backlog|todo|planned)\b/i;
const LINEAR_IDENTIFIER_PATTERN = /\b[A-Z]{2,}-\d+\b/;

type CoverageItem = {
  identifier: string | null;
  text: string;
  aliases: string[];
  status: "completed" | "in_progress" | "unknown";
};

const STOP_WORDS = new Set(["a", "an", "and", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);

function tokenize(value: string) {
  return normalizeComparableText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function summaryMentionsAlias(summary: string, alias: string) {
  const normalizedSummary = normalizeComparableText(summary);
  const normalizedAlias = normalizeComparableText(alias);
  if (!normalizedSummary || !normalizedAlias) {
    return false;
  }

  if (normalizedSummary.includes(normalizedAlias) || normalizedAlias.includes(normalizedSummary)) {
    return true;
  }

  const summaryTokens = new Set(tokenize(summary));
  const aliasTokens = tokenize(alias);
  if (!aliasTokens.length) {
    return false;
  }

  let overlap = 0;
  for (const token of aliasTokens) {
    if (summaryTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / aliasTokens.length >= 0.75;
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeComparableText(value: string) {
  return normalizeWhitespace(
    value
      .toLowerCase()
      .replace(/<https?:\/\/[^|>]+\|[^>]+>/g, " ")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[`*_~]/g, " ")
      .replace(/[^a-z0-9\s#/-]/g, " "),
  );
}

function getWorkHeader(period: SummaryPeriod) {
  return period === "week" ? "This week's work:" : "Today's work:";
}

function extractLinearIdentifier(value?: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(LINEAR_IDENTIFIER_PATTERN);
  return match?.[0] ?? null;
}

function stripLeadingIdentifier(value: string, identifier: string | null) {
  if (!identifier) {
    return value.trim();
  }

  return value.replace(new RegExp(`^${identifier}\\s+`, "i"), "").trim();
}

function buildLinearCoverageItem(entry: SummaryLogEntry): CoverageItem | null {
  if (entry.source !== "linear_issue") {
    return null;
  }

  const title = entry.title?.trim() ?? "";
  const content = entry.content.trim();
  const identifier = extractLinearIdentifier(title) ?? extractLinearIdentifier(content);
  const cleanTitle = stripLeadingIdentifier(title, identifier);
  const cleanContent = stripLeadingIdentifier(content, identifier);

  const text = cleanTitle && cleanContent
    ? `${identifier ? `${identifier} ` : ""}${cleanTitle} ${cleanContent}`.trim()
    : cleanTitle || cleanContent;

  if (!text) {
    return null;
  }

  const statusText = `${title} ${content}`.trim();
  const status = LINEAR_COMPLETED_STATE_PATTERN.test(statusText)
    ? "completed"
    : LINEAR_IN_PROGRESS_STATE_PATTERN.test(statusText)
      ? "in_progress"
      : "unknown";

  const aliases = [
    cleanTitle,
    identifier && cleanTitle ? `${identifier} ${cleanTitle}` : null,
    identifier && cleanTitle ? `${cleanTitle} (${identifier})` : null,
    cleanContent,
    text,
  ].filter((alias): alias is string => Boolean(alias));

  return {
    identifier,
    text: truncateLine(text),
    aliases,
    status,
  };
}

function dedupeCoverageItems(items: CoverageItem[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = item.identifier
      ? `id:${item.identifier.toLowerCase()}`
      : `text:${normalizeComparableText(item.text)}`;

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function summaryAlreadyMentionsItem(summary: string, item: CoverageItem) {
  const normalizedSummary = normalizeComparableText(summary);
  if (!normalizedSummary) {
    return false;
  }

  if (item.identifier && normalizedSummary.includes(item.identifier.toLowerCase())) {
    return true;
  }

  return item.aliases.some((alias) => summaryMentionsAlias(summary, alias));
}

function insertCompletedBullets(lines: string[], bullets: string[], period: SummaryPeriod) {
  if (!bullets.length) {
    return lines;
  }

  const workHeader = getWorkHeader(period);
  const workIndex = lines.findIndex((line) => line.trim() === workHeader);
  if (workIndex === -1) {
    return lines;
  }

  const inProgressIndex = lines.findIndex((line) => line.trim() === "In progress:");
  const blockersIndex = lines.findIndex((line) => line.trim() === "Blockers:");
  const sectionEndCandidates = [inProgressIndex, blockersIndex].filter((index) => index !== -1);
  const insertAt = sectionEndCandidates.length ? Math.min(...sectionEndCandidates) : lines.length;

  lines.splice(insertAt, 0, ...bullets.map((bullet) => `- ${bullet}`));
  return lines;
}

function insertInProgressBullets(lines: string[], bullets: string[]) {
  if (!bullets.length) {
    return lines;
  }

  const blockersIndex = lines.findIndex((line) => line.trim() === "Blockers:");
  const existingIndex = lines.findIndex((line) => line.trim() === "In progress:");

  if (existingIndex !== -1) {
    const insertAt = blockersIndex !== -1 ? blockersIndex : lines.length;
    lines.splice(insertAt, 0, ...bullets.map((bullet) => `- ${bullet}`));
    return lines;
  }

  const insertAt = blockersIndex !== -1 ? blockersIndex : lines.length;
  const sectionLines = ["", "In progress:", ...bullets.map((bullet) => `- ${bullet}`)];
  lines.splice(insertAt, 0, ...sectionLines);
  return lines;
}

export function ensureLinearActivityCoverage(
  summary: string,
  entries: SummaryLogEntry[],
  period: SummaryPeriod,
) {
  const missingItems = dedupeCoverageItems(
    entries
      .map((entry) => buildLinearCoverageItem(entry))
      .filter((item): item is CoverageItem => Boolean(item)),
  ).filter((item) => !summaryAlreadyMentionsItem(summary, item));

  if (!missingItems.length) {
    return summary;
  }

  const completed = missingItems
    .filter((item) => item.status !== "in_progress")
    .map((item) => item.text);
  const inProgress = missingItems
    .filter((item) => item.status === "in_progress")
    .map((item) => item.text);

  const lines = summary.split("\n");
  insertCompletedBullets(lines, completed, period);
  insertInProgressBullets(lines, inProgress);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}
