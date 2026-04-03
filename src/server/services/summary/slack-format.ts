import { EntrySource } from "@prisma/client";
import type { SummaryLogEntry } from "./types";
import { buildLinearTaskText, extractTicketIdentifier, parseCommitEntry, truncateLine } from "./task-processing";
import { getEntrySourceRef } from "./source-refs";

const TOP_LEVEL_BULLET_PATTERN = /^-\s+/;
const NESTED_BULLET_PATTERN = /^\s{2,}-\s+/;
const EXISTING_LINK_PATTERN = /<https?:\/\/[^|>]+\|[^>]+>|https?:\/\/\S+/i;
const REF_PATTERN = /\s*\[ref:([a-z0-9_]+)\]/gi;
const OTHER_VISIBLE_LIMIT = 5;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

const CANONICAL_TOKENS: Record<string, string> = {
  added: "add",
  adding: "add",
  connection: "connect",
  connected: "connect",
  connecting: "connect",
  deduped: "dedupe",
  deduping: "dedupe",
  deduplication: "dedupe",
  fixed: "fix",
  fixes: "fix",
  fixing: "fix",
  improved: "improve",
  improving: "improve",
  optimised: "optimize",
  optimising: "optimize",
  optimized: "optimize",
  optimizing: "optimize",
  placeholders: "placeholder",
  refined: "refine",
  refining: "refine",
  sped: "speed",
  speeding: "speed",
  suffixes: "suffix",
  summaries: "summary",
};

type LinkCandidate = {
  ref: string | null;
  url: string;
  aliases: string[];
  source: SummaryLogEntry["source"];
  entry: SummaryLogEntry;
};

type SummaryGroupLine = {
  text: string;
  refs: string[];
};

type ParsedSummaryGroup = {
  title: string;
  titleRefs: string[];
  items: SummaryGroupLine[];
};

type ParsedSummaryStructure = {
  header: string[];
  statusSnapshot: SummaryGroupLine[];
  groups: ParsedSummaryGroup[];
  needsReview: SummaryGroupLine[];
  blockers: string[];
};

type ResolvedGroupLink = {
  url: string;
  source: SummaryLogEntry["source"] | "compare";
};

type ReviewNeededPullRequest = {
  text: string;
  url: string;
};

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/<https?:\/\/[^|>]+\|[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9\s#/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeToken(token: string) {
  const direct = CANONICAL_TOKENS[token];
  if (direct) {
    return direct;
  }

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

function tokenize(value: string) {
  return normalizeText(value)
    .split(" ")
    .map((token) => canonicalizeToken(token))
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function buildKeywordSet(value: string) {
  return new Set(tokenize(value));
}

function stripConventionalCommitPrefix(value: string) {
  return value.replace(/^(feat|fix|refactor|chore|docs|style|test|perf)(\([^)]+\))?!?:\s*/i, "").trim();
}

function stripRepoPrefixedCommit(value: string) {
  return value.replace(/^Commit to .*?:\s*/i, "").trim();
}

function stripTicketPrefix(value: string, ticket: string | null) {
  if (!ticket) {
    return value.trim();
  }

  return value.replace(new RegExp(`^${ticket}\\s*[:\\-]?\\s*`, "i"), "").trim();
}

function buildLinearAliases(entry: SummaryLogEntry) {
  const aliases = [
    entry.title ?? "",
    entry.content,
    buildLinearTaskText(entry).replace(/^Linear:\s*/, ""),
  ];
  const ticket = `${entry.title ?? ""} ${entry.content}`.match(/\b[A-Z]{2,}-\d+\b/)?.[0];
  const cleanTitle = (entry.title ?? "").replace(new RegExp(`^${ticket ?? ""}\\s+`, "i"), "").trim();

  if (ticket && cleanTitle) {
    aliases.push(`${cleanTitle} (${ticket})`);
  }

  return aliases.filter(Boolean);
}

function buildAliases(entry: SummaryLogEntry) {
  if (entry.source === EntrySource.github_commit) {
    const title = entry.title ?? entry.content;
    const content = entry.content.replace(/^Commit to .*?:\s*/i, "").trim();
    return [title, stripConventionalCommitPrefix(title), content, stripConventionalCommitPrefix(content)].filter(Boolean);
  }

  if (entry.source === EntrySource.linear_issue) {
    return buildLinearAliases(entry);
  }

  return [entry.title ?? entry.content, entry.content].filter(Boolean);
}

function buildLinkCandidates(entries: SummaryLogEntry[]) {
  return entries
    .filter(
      (entry) =>
        Boolean(entry.externalUrl) &&
        (entry.source === EntrySource.github_commit ||
          entry.source === EntrySource.github_pr ||
          entry.source === EntrySource.linear_issue),
    )
    .map((entry) => ({
      ref: getEntrySourceRef(entry),
      url: entry.externalUrl as string,
      aliases: buildAliases(entry),
      source: entry.source,
      entry,
    }));
}

function scoreCandidate(line: string, candidate: LinkCandidate) {
  const normalizedLine = normalizeText(line);
  const lineKeywords = buildKeywordSet(line);
  let bestScore = 0;

  for (const alias of candidate.aliases) {
    const normalizedAlias = normalizeText(alias);
    if (!normalizedAlias) {
      continue;
    }

    if (normalizedLine === normalizedAlias) {
      return 1;
    }

    if (normalizedLine.includes(normalizedAlias) || normalizedAlias.includes(normalizedLine)) {
      bestScore = Math.max(bestScore, 0.9);
    }

    const aliasKeywords = buildKeywordSet(alias);
    if (!aliasKeywords.size) {
      continue;
    }

    let overlap = 0;
    for (const keyword of aliasKeywords) {
      if (lineKeywords.has(keyword)) {
        overlap += 1;
      }
    }

    if (!overlap) {
      continue;
    }

    const coverage = overlap / aliasKeywords.size;
    const precision = overlap / Math.max(lineKeywords.size, 1);
    const score = coverage * 0.75 + precision * 0.25;
    bestScore = Math.max(bestScore, score);
  }

  return bestScore;
}

function findCandidate(line: string, candidates: LinkCandidate[], mode: "group" | "item") {
  const pool =
    mode === "group"
      ? candidates.filter((candidate) => candidate.source !== EntrySource.github_commit)
      : candidates;

  const scored = pool
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(line, candidate),
    }))
    .filter((item) => item.score >= 0.62)
    .sort((left, right) => right.score - left.score);

  if (!scored.length) {
    return null;
  }

  const best = scored[0]!;
  const second = scored[1];
  if (second && best.score - second.score < 0.08) {
    return null;
  }

  return best.candidate;
}

function extractRefs(line: string) {
  const refs: string[] = [];

  for (const match of line.matchAll(REF_PATTERN)) {
    const ref = match[1]?.trim().toLowerCase();
    if (ref && !refs.includes(ref)) {
      refs.push(ref);
    }
  }

  return refs;
}

function stripRefs(line: string) {
  return line.replace(REF_PATTERN, "").replace(/[ \t]+$/g, "");
}

function hasExistingLink(text: string) {
  return EXISTING_LINK_PATTERN.test(text);
}

function escapeSlackLinkText(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\|/g, "¦");
}

function escapeSlackText(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderSectionTitle(text: string) {
  return `*${escapeSlackText(text)}*`;
}

function buildCompactHeading(
  title: string,
  primaryLink: ResolvedGroupLink | null,
  secondaryLink: ResolvedGroupLink | null,
) {
  const headingCore =
    primaryLink && !hasExistingLink(title)
      ? `*<${primaryLink.url}|${escapeSlackLinkText(title)}>*`
      : renderSectionTitle(title);

  if (!secondaryLink) {
    return headingCore;
  }

  return `${headingCore} · <${secondaryLink.url}|${getSecondaryLinkLabel(secondaryLink)}>`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readGithubPrMetadata(entry: SummaryLogEntry) {
  if (entry.source !== EntrySource.github_pr || !isRecord(entry.metadata)) {
    return null;
  }

  const githubPrValue = entry.metadata.githubPr ?? entry.metadata.github_pr;
  if (!isRecord(githubPrValue)) {
    return null;
  }

  const stateValue = readString(githubPrValue.state);
  const state = stateValue === "open" || stateValue === "closed" ? stateValue : null;

  return {
    state,
    draft: readBoolean(githubPrValue.draft) ?? false,
    awaitingReview: readBoolean(githubPrValue.awaitingReview),
  };
}

function getPullRequestStatus(entry: SummaryLogEntry) {
  if (entry.source !== EntrySource.github_pr) {
    return null;
  }

  if (/^PR merged\b/i.test(entry.content) || /:merged:/i.test(entry.externalId ?? "")) {
    return "merged" as const;
  }

  if (/^PR closed\b/i.test(entry.content) || /:closed:/i.test(entry.externalId ?? "")) {
    return "closed" as const;
  }

  const metadata = readGithubPrMetadata(entry);
  if (metadata?.state === "closed") {
    return "closed" as const;
  }

  return "open" as const;
}

function isPullRequestAwaitingReview(entry: SummaryLogEntry) {
  if (entry.source !== EntrySource.github_pr || !entry.externalUrl) {
    return false;
  }

  if (getPullRequestStatus(entry) !== "open") {
    return false;
  }

  const metadata = readGithubPrMetadata(entry);
  if (metadata?.draft) {
    return false;
  }

  if (typeof metadata?.awaitingReview === "boolean") {
    return metadata.awaitingReview;
  }

  return true;
}

function buildLatestPullRequests(entries: SummaryLogEntry[]) {
  const latestByKey = new Map<string, SummaryLogEntry>();

  for (const entry of entries) {
    if (entry.source !== EntrySource.github_pr) {
      continue;
    }

    const key = entry.externalUrl ?? entry.externalId ?? entry.id;
    const existing = latestByKey.get(key);
    if (!existing || entry.createdAt.getTime() >= existing.createdAt.getTime()) {
      latestByKey.set(key, entry);
    }
  }

  return [...latestByKey.values()].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function joinNaturalLanguage(parts: string[]) {
  if (parts.length <= 1) {
    return parts[0] ?? "";
  }

  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`;
  }

  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function trimTrailingPeriod(value: string) {
  return value.replace(/\.+$/g, "").trim();
}

function looksLikeSameHeadingTitle(left: string, right: string) {
  const normalizedLeft = trimTrailingPeriod(normalizeText(left));
  const normalizedRight = trimTrailingPeriod(normalizeText(right));

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

function compressRenderedItemText(text: string, groupTitle: string) {
  const prPrefixMatch = text.match(/^PR\s+(.+?):\s+(.+)$/i);
  if (prPrefixMatch?.[1] && prPrefixMatch[2]) {
    const action = prPrefixMatch[1].trim();
    const title = prPrefixMatch[2].trim();
    if (looksLikeSameHeadingTitle(stripTicketPrefix(title, extractTicketIdentifier(title, groupTitle)), groupTitle)) {
      return `${action.charAt(0).toUpperCase() + action.slice(1).toLowerCase()} PR`;
    }
  }

  const prSuffixMatch = text.match(/^(.+?)\s+PR:\s+(.+)$/i);
  if (prSuffixMatch?.[1] && prSuffixMatch[2]) {
    const action = prSuffixMatch[1].trim();
    const title = prSuffixMatch[2].trim();
    if (looksLikeSameHeadingTitle(stripTicketPrefix(title, extractTicketIdentifier(title, groupTitle)), groupTitle)) {
      return `${action.charAt(0).toUpperCase() + action.slice(1).toLowerCase()} PR`;
    }
  }

  return text;
}

function formatTitleList(titles: string[], limit = 3) {
  const unique = titles.filter((title, index) => titles.findIndex((candidate) => normalizeText(candidate) === normalizeText(title)) === index);
  const visible = unique.slice(0, limit).map((title) => trimTrailingPeriod(title));

  if (unique.length > limit && visible.length) {
    const remaining = unique.length - limit;
    return `${joinNaturalLanguage(visible)}, and ${remaining} more`;
  }

  return joinNaturalLanguage(visible);
}

function formatNeedsReviewTitle(entry: SummaryLogEntry, hasMultipleRepos: boolean) {
  const ticket = getEntryTicket(entry);
  const rawTitle = entry.title?.trim()
    || entry.content.replace(/^PR\s+.+?\s+in\s+[^:]+:\s*/i, "").trim()
    || "Open PR";
  const cleanedTitle = stripTicketPrefix(rawTitle, ticket);
  const normalizedTitle = ticket && cleanedTitle ? `${ticket} - ${cleanedTitle}` : rawTitle;

  if (hasMultipleRepos && !ticket && entry.project?.githubRepo) {
    return truncateLine(`[${entry.project.githubRepo}] ${normalizedTitle}`);
  }

  return truncateLine(normalizedTitle);
}

function buildNeedsReviewItems(entries: SummaryLogEntry[]) {
  const latestPullRequests = buildLatestPullRequests(entries);
  const repoCount = new Set(
    latestPullRequests
      .map((entry) => entry.project?.githubRepo ?? null)
      .filter((repo): repo is string => Boolean(repo)),
  ).size;
  const hasMultipleRepos = repoCount > 1;

  return latestPullRequests
    .filter((entry) => isPullRequestAwaitingReview(entry) && Boolean(entry.externalUrl))
    .map((entry) => ({
      text: formatNeedsReviewTitle(entry, hasMultipleRepos),
      url: entry.externalUrl as string,
    }));
}

function buildStatusSnapshotLines(
  structure: ParsedSummaryStructure,
  entries: SummaryLogEntry[],
  needsReviewItems: ReviewNeededPullRequest[],
) {
  const explicitLines = structure.statusSnapshot
    .map((line) => line.text.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (explicitLines.length) {
    return explicitLines;
  }

  const lines: string[] = [];
  const ticketGroups = structure.groups.filter((group) => !isOtherGroupTitle(group.title));
  if (ticketGroups.length) {
    const groupLabel = pluralize(ticketGroups.length, "ticketed workstream");
    const titleList = formatTitleList(ticketGroups.map((group) => group.title));
    lines.push(`Advanced ${ticketGroups.length} ${groupLabel}: ${titleList}.`);
  } else if (structure.groups.some((group) => isOtherGroupTitle(group.title))) {
    lines.push("Captured progress across miscellaneous work.");
  }

  const latestPullRequests = buildLatestPullRequests(entries);
  const mergedPrCount = latestPullRequests.filter((entry) => getPullRequestStatus(entry) === "merged").length;
  const commitCount = new Set(
    entries
      .filter((entry) => entry.source === EntrySource.github_commit)
      .map((entry) => entry.externalUrl ?? entry.externalId ?? entry.id),
  ).size;
  const githubParts: string[] = [];
  if (mergedPrCount) {
    githubParts.push(`${mergedPrCount} merged ${pluralize(mergedPrCount, "PR")}`);
  }
  if (commitCount) {
    githubParts.push(`${commitCount} ${pluralize(commitCount, "commit")}`);
  }
  if (githubParts.length) {
    lines.push(`GitHub activity included ${joinNaturalLanguage(githubParts)}.`);
  }

  if (needsReviewItems.length) {
    lines.push(`${needsReviewItems.length} ${pluralize(needsReviewItems.length, "PR")} ${needsReviewItems.length === 1 ? "is" : "are"} waiting on review.`);
  } else if (structure.blockers.length) {
    lines.push(`${structure.blockers.length} ${pluralize(structure.blockers.length, "blocker")} ${structure.blockers.length === 1 ? "remains" : "remain"} open.`);
  }

  return lines.slice(0, 3);
}

function buildExactCandidates(
  refs: string[],
  candidatesByRef: Map<string, LinkCandidate>,
  mode: "group" | "item",
) {
  const exact = refs
    .map((ref) => candidatesByRef.get(ref) ?? null)
    .filter((candidate): candidate is LinkCandidate => Boolean(candidate));

  if (mode === "group") {
    const nonCommit = exact.find((candidate) => candidate.source !== EntrySource.github_commit);
    return nonCommit ? [nonCommit] : [];
  }

  return exact;
}

function extractGroupTicket(group: ParsedSummaryGroup) {
  return extractTicketIdentifier(group.title, ...group.items.map((item) => item.text));
}

function isOtherGroupTitle(title: string) {
  return normalizeText(title) === "other";
}

function getEntryTicket(entry: SummaryLogEntry) {
  return extractTicketIdentifier(entry.title ?? null, entry.content);
}

function buildCompareUrl(entries: SummaryLogEntry[]) {
  const commits = entries
    .map((entry) => parseCommitEntry(entry))
    .filter((entry): entry is NonNullable<ReturnType<typeof parseCommitEntry>> => Boolean(entry))
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

  if (commits.length < 2) {
    return null;
  }

  const repos = [...new Set(commits.map((commit) => commit.repo))];
  if (repos.length !== 1) {
    return null;
  }

  const uniqueShas = commits
    .map((commit) => commit.sha)
    .filter((sha, index, all) => all.indexOf(sha) === index);

  if (uniqueShas.length < 2) {
    return null;
  }

  return `https://github.com/${repos[0]}/compare/${uniqueShas[0]}..${uniqueShas[uniqueShas.length - 1]}`;
}

function formatFallbackGithubPrItem(entry: SummaryLogEntry, groupTitle: string, ticket: string | null) {
  const contentMatch = entry.content.match(/^PR\s+(.+?)\s+in\s+[^:]+:\s*(.+)$/i);
  const action = contentMatch?.[1]?.trim() ?? "";
  const rawTitle = contentMatch?.[2]?.trim() || entry.title || "";
  const title = stripTicketPrefix(rawTitle, ticket);

  if (title && normalizeText(title) !== normalizeText(stripTicketPrefix(groupTitle, ticket))) {
    if (action) {
      const formattedAction = action.charAt(0).toUpperCase() + action.slice(1).toLowerCase();
      return truncateLine(`${formattedAction} PR: ${title}`);
    }

    return truncateLine(title);
  }

  if (action) {
    const formattedAction = action.charAt(0).toUpperCase() + action.slice(1).toLowerCase();
    return truncateLine(`${formattedAction} PR`);
  }

  return "Updated PR";
}

function formatFallbackEntryItem(entry: SummaryLogEntry, groupTitle: string) {
  const ticket = getEntryTicket(entry);
  const cleanedGroupTitle = stripTicketPrefix(groupTitle, ticket);

  if (entry.source === EntrySource.github_commit) {
    const text = stripTicketPrefix(stripRepoPrefixedCommit(entry.title ?? entry.content), ticket);
    return truncateLine(text || "Updated code");
  }

  if (entry.source === EntrySource.github_pr) {
    return formatFallbackGithubPrItem(entry, groupTitle, ticket);
  }

  if (entry.source === EntrySource.linear_issue) {
    const content = stripTicketPrefix(entry.content, ticket);
    if (content && normalizeText(content) !== normalizeText(cleanedGroupTitle)) {
      return truncateLine(content.charAt(0).toUpperCase() + content.slice(1));
    }

    const title = stripTicketPrefix(entry.title ?? "", ticket);
    if (title && normalizeText(title) !== normalizeText(cleanedGroupTitle)) {
      return truncateLine(title);
    }

    return "Updated Linear issue";
  }

  const text = stripTicketPrefix(entry.content, ticket);
  if (text && normalizeText(text) !== normalizeText(cleanedGroupTitle)) {
    return truncateLine(text);
  }

  return "Worked on this";
}

function buildFallbackGroupItems(
  group: ParsedSummaryGroup,
  matchedEntries: SummaryLogEntry[],
  primaryLink: ResolvedGroupLink | null,
) {
  if (!matchedEntries.length) {
    return [];
  }

  const sortedEntries = matchedEntries
    .slice()
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  const commitEntries = sortedEntries.filter((entry) => entry.source === EntrySource.github_commit);
  const candidateEntries =
    commitEntries.length > 0
      ? commitEntries
      : (() => {
          if (!primaryLink) {
            return sortedEntries;
          }

          const nonPrimaryEntries = sortedEntries.filter(
            (entry) => !(entry.source === primaryLink.source && entry.externalUrl === primaryLink.url),
          );

          return nonPrimaryEntries.length ? nonPrimaryEntries : sortedEntries;
        })();

  const seen = new Set<string>();
  const items: string[] = [];

  for (const entry of candidateEntries) {
    const text = formatFallbackEntryItem(entry, group.title);
    const key = normalizeText(text);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    items.push(text);
  }

  return items;
}

function buildVisibleGroupItems(
  group: ParsedSummaryGroup,
  matchedEntries: SummaryLogEntry[],
  primaryLink: ResolvedGroupLink | null,
) {
  const explicitItems = group.items.map((item) => item.text);
  if (explicitItems.length) {
    return isOtherGroupTitle(group.title) ? explicitItems.slice(0, OTHER_VISIBLE_LIMIT) : explicitItems;
  }

  const generatedItems = buildFallbackGroupItems(group, matchedEntries, primaryLink);
  return isOtherGroupTitle(group.title) ? generatedItems.slice(0, OTHER_VISIBLE_LIMIT) : generatedItems;
}

const SECTION_HEADING_PATTERN = /^##\s+(.+?)\s*$/i;

function getSectionKind(title: string) {
  const normalizedTitle = normalizeText(title);

  if (normalizedTitle === "status snapshot") {
    return "status_snapshot" as const;
  }

  if (normalizedTitle === "needs review") {
    return "needs_review" as const;
  }

  if (normalizedTitle === "blockers") {
    return "blockers" as const;
  }

  return "group" as const;
}

function parseSectionedSummaryStructure(summary: string): ParsedSummaryStructure {
  const header: string[] = [];
  const statusSnapshot: SummaryGroupLine[] = [];
  const groups: ParsedSummaryGroup[] = [];
  const needsReview: SummaryGroupLine[] = [];
  const blockers: string[] = [];
  let section: "header" | "status_snapshot" | "group" | "needs_review" | "blockers" = "header";
  let currentGroup: ParsedSummaryGroup | null = null;

  for (const rawLine of summary.split("\n")) {
    const refs = extractRefs(rawLine);
    const cleanedLine = stripRefs(rawLine);
    const trimmed = cleanedLine.trim();

    if (!trimmed) {
      continue;
    }

    const headingMatch = trimmed.match(SECTION_HEADING_PATTERN);
    if (headingMatch?.[1]) {
      if (currentGroup) {
        groups.push(currentGroup);
        currentGroup = null;
      }

      const title = headingMatch[1].trim();
      const sectionKind = getSectionKind(title);

      if (sectionKind === "group") {
        currentGroup = {
          title,
          titleRefs: refs,
          items: [],
        };
        section = "group";
      } else {
        section = sectionKind;
      }
      continue;
    }

    if (section === "header") {
      header.push(trimmed);
      continue;
    }

    if (!TOP_LEVEL_BULLET_PATTERN.test(cleanedLine)) {
      continue;
    }

    const text = trimmed.replace(TOP_LEVEL_BULLET_PATTERN, "").trim();
    if (!text) {
      continue;
    }

    if (section === "status_snapshot") {
      statusSnapshot.push({ text, refs });
      continue;
    }

    if (section === "group" && currentGroup) {
      currentGroup.items.push({ text, refs });
      continue;
    }

    if (section === "needs_review") {
      needsReview.push({ text, refs });
      continue;
    }

    if (section === "blockers") {
      blockers.push(text);
    }
  }

  if (currentGroup) {
    groups.push(currentGroup);
  }

  return { header, statusSnapshot, groups, needsReview, blockers };
}

function parseLegacySummaryStructure(summary: string): ParsedSummaryStructure {
  const header: string[] = [];
  const groups: ParsedSummaryGroup[] = [];
  const blockers: string[] = [];
  let section: "header" | "groups" | "next_up" | "blockers" = "header";
  let currentGroup: ParsedSummaryGroup | null = null;

  for (const rawLine of summary.split("\n")) {
    const refs = extractRefs(rawLine);
    const cleanedLine = stripRefs(rawLine);
    const trimmed = cleanedLine.trim();

    if (!trimmed) {
      continue;
    }

    if (/^Next up:\s*$/i.test(trimmed)) {
      if (currentGroup) {
        groups.push(currentGroup);
        currentGroup = null;
      }
      section = "next_up";
      continue;
    }

    if (/^Blockers:\s*$/i.test(trimmed)) {
      if (currentGroup) {
        groups.push(currentGroup);
        currentGroup = null;
      }
      section = "blockers";
      continue;
    }

    if (section === "header") {
      if (TOP_LEVEL_BULLET_PATTERN.test(cleanedLine)) {
        section = "groups";
      } else {
        header.push(trimmed);
        continue;
      }
    }

    if (section === "groups") {
      if (TOP_LEVEL_BULLET_PATTERN.test(cleanedLine)) {
        if (currentGroup) {
          groups.push(currentGroup);
        }
        currentGroup = {
          title: trimmed.replace(TOP_LEVEL_BULLET_PATTERN, "").trim(),
          titleRefs: refs,
          items: [],
        };
        continue;
      }

      if (NESTED_BULLET_PATTERN.test(cleanedLine) && currentGroup) {
        currentGroup.items.push({
          text: cleanedLine.replace(NESTED_BULLET_PATTERN, "").trim(),
          refs,
        });
      }
      continue;
    }

    if (section === "blockers" && TOP_LEVEL_BULLET_PATTERN.test(cleanedLine)) {
      blockers.push(trimmed.replace(TOP_LEVEL_BULLET_PATTERN, "").trim());
    }
  }

  if (currentGroup) {
    groups.push(currentGroup);
  }

  return {
    header,
    statusSnapshot: [],
    groups,
    needsReview: [],
    blockers,
  };
}

function parseSummaryStructure(summary: string) {
  const hasSectionHeadings = summary
    .split("\n")
    .some((line) => SECTION_HEADING_PATTERN.test(stripRefs(line).trim()));

  return hasSectionHeadings
    ? parseSectionedSummaryStructure(summary)
    : parseLegacySummaryStructure(summary);
}

function resolveGroupEntries(
  group: ParsedSummaryGroup,
  entries: SummaryLogEntry[],
  candidates: LinkCandidate[],
  candidatesByRef: Map<string, LinkCandidate>,
) {
  const matched = new Map<string, SummaryLogEntry>();
  const addEntry = (entry?: SummaryLogEntry | null) => {
    if (!entry) {
      return;
    }
    matched.set(entry.id, entry);
  };
  const addCandidate = (candidate?: LinkCandidate | null) => addEntry(candidate?.entry ?? null);

  for (const candidate of buildExactCandidates(group.titleRefs, candidatesByRef, "group")) {
    addCandidate(candidate);
  }

  if (!matched.size) {
    addCandidate(findCandidate(group.title, candidates, "group"));
  }

  for (const item of group.items) {
    const exactItemCandidates = buildExactCandidates(item.refs, candidatesByRef, "item");
    if (exactItemCandidates.length) {
      exactItemCandidates.forEach((candidate) => addCandidate(candidate));
      continue;
    }

    addCandidate(findCandidate(item.text, candidates, "item"));
  }

  const ticket = extractGroupTicket(group) ?? [...matched.values()].map((entry) => getEntryTicket(entry)).find(Boolean) ?? null;
  if (ticket) {
    for (const entry of entries) {
      if (getEntryTicket(entry) === ticket) {
        addEntry(entry);
      }
    }
  }

  return [...matched.values()];
}

function getUniqueUrls(entries: SummaryLogEntry[], source: SummaryLogEntry["source"]) {
  return [...new Set(
    entries
      .filter((entry) => entry.source === source && entry.externalUrl)
      .map((entry) => entry.externalUrl as string),
  )];
}

function buildCommitWorkLink(entries: SummaryLogEntry[]) {
  const compareUrl = buildCompareUrl(entries);
  if (compareUrl) {
    return compareUrl;
  }

  const commits = entries
    .map((entry) => parseCommitEntry(entry))
    .filter((entry): entry is NonNullable<ReturnType<typeof parseCommitEntry>> => Boolean(entry))
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  const repos = [...new Set(commits.map((commit) => commit.repo))];
  const uniqueShas = [...new Set(commits.map((commit) => commit.sha))];

  if (repos.length !== 1 || uniqueShas.length !== 1) {
    return null;
  }

  return entries.find(
    (entry) => entry.source === EntrySource.github_commit && entry.externalUrl?.includes(`/commit/${uniqueShas[0]}`),
  )?.externalUrl ?? null;
}

function choosePrimaryGroupLink(
  group: ParsedSummaryGroup,
  matchedEntries: SummaryLogEntry[],
  candidatesByRef: Map<string, LinkCandidate>,
): ResolvedGroupLink | null {
  if (isOtherGroupTitle(group.title)) {
    return null;
  }

  const titleCandidates = group.titleRefs
    .map((ref) => candidatesByRef.get(ref) ?? null)
    .filter((candidate): candidate is LinkCandidate => Boolean(candidate));
  const exactLinear = titleCandidates.find((candidate) => candidate.source === EntrySource.linear_issue);
  if (exactLinear) {
    return { url: exactLinear.url, source: exactLinear.source };
  }

  const exactPr = titleCandidates.find((candidate) => candidate.source === EntrySource.github_pr);
  if (exactPr) {
    return { url: exactPr.url, source: exactPr.source };
  }

  const linearUrls = getUniqueUrls(matchedEntries, EntrySource.linear_issue);
  if (linearUrls.length === 1) {
    return { url: linearUrls[0]!, source: EntrySource.linear_issue };
  }

  const prUrls = getUniqueUrls(matchedEntries, EntrySource.github_pr);
  if (prUrls.length === 1) {
    return { url: prUrls[0]!, source: EntrySource.github_pr };
  }

  return null;
}

function chooseSecondaryGroupLink(
  group: ParsedSummaryGroup,
  matchedEntries: SummaryLogEntry[],
  primaryLink: ResolvedGroupLink | null,
): ResolvedGroupLink | null {
  if (primaryLink?.source === EntrySource.github_pr) {
    return null;
  }

  if (isOtherGroupTitle(group.title)) {
    const compareUrl = buildCompareUrl(matchedEntries);
    return compareUrl ? { url: compareUrl, source: "compare" } : null;
  }

  const prUrls = getUniqueUrls(matchedEntries, EntrySource.github_pr);
  if (prUrls.length === 1 && prUrls[0] !== primaryLink?.url) {
    return { url: prUrls[0]!, source: EntrySource.github_pr };
  }

  const commitWorkUrl = buildCommitWorkLink(matchedEntries);
  if (commitWorkUrl && commitWorkUrl !== primaryLink?.url) {
    return {
      url: commitWorkUrl,
      source: commitWorkUrl.includes("/compare/") ? "compare" : EntrySource.github_commit,
    };
  }

  return null;
}

function getSecondaryLinkLabel(link: ResolvedGroupLink) {
  if (link.source === EntrySource.github_pr) {
    return "PR";
  }

  if (link.source === "compare") {
    return "Compare";
  }

  if (link.source === EntrySource.github_commit) {
    return "Commit";
  }

  return "Link";
}

export function isStructuredTicketSummary(summary: string) {
  const lines = summary
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return false;
  }

  const header = lines[0] ?? "";
  if (!/^(daily|weekly)\s+update\b/i.test(header)) {
    return false;
  }

  if (lines.some((line) => TOP_LEVEL_BULLET_PATTERN.test(line))) {
    return true;
  }

  return lines.some((line) => {
    const headingMatch = line.match(SECTION_HEADING_PATTERN);
    if (!headingMatch?.[1]) {
      return false;
    }

    return getSectionKind(headingMatch[1]) === "group";
  });
}

export function hasStructuredNonOtherGroup(summary: string) {
  const structure = parseSummaryStructure(summary);
  return structure.groups.some((group) => !isOtherGroupTitle(group.title));
}

function buildExplicitNeedsReviewItems(
  lines: SummaryGroupLine[],
  candidates: LinkCandidate[],
  candidatesByRef: Map<string, LinkCandidate>,
) {
  const prCandidates = candidates.filter((candidate) => candidate.source === EntrySource.github_pr);
  const seen = new Set<string>();
  const items: ReviewNeededPullRequest[] = [];

  for (const line of lines) {
    const exactCandidate = buildExactCandidates(line.refs, candidatesByRef, "item")
      .find((candidate) => candidate.source === EntrySource.github_pr) ?? null;
    const matchedCandidate = exactCandidate ?? findCandidate(line.text, prCandidates, "item");
    const url = matchedCandidate?.url ?? null;
    const key = `${normalizeText(line.text)}|${url ?? ""}`;

    if (!line.text || seen.has(key)) {
      continue;
    }

    seen.add(key);
    if (url) {
      items.push({ text: line.text, url });
      continue;
    }

    items.push({ text: line.text, url: "" });
  }

  return items;
}

function orderGroupsForRender(groups: ParsedSummaryGroup[]) {
  const ticketGroups = groups.filter((group) => !isOtherGroupTitle(group.title));
  const otherGroups = groups.filter((group) => isOtherGroupTitle(group.title));
  return [...ticketGroups, ...otherGroups];
}

export function renderSummaryForSlack(summary: string, entries: SummaryLogEntry[]) {
  const candidates = buildLinkCandidates(entries);
  const candidatesByRef = new Map(
    candidates
      .filter((candidate): candidate is LinkCandidate & { ref: string } => Boolean(candidate.ref))
      .map((candidate) => [candidate.ref, candidate]),
  );
  const structure = parseSummaryStructure(summary);
  const output: string[] = [];
  const assignedEntryIds = new Set<string>();
  const derivedNeedsReviewItems = buildNeedsReviewItems(entries);
  const needsReviewItems = derivedNeedsReviewItems.length
    ? derivedNeedsReviewItems
    : buildExplicitNeedsReviewItems(structure.needsReview, candidates, candidatesByRef);
  const statusSnapshotLines = buildStatusSnapshotLines(structure, entries, needsReviewItems);

  output.push(...structure.header);

  if (statusSnapshotLines.length) {
    output.push(renderSectionTitle("Status snapshot"));
    for (const line of statusSnapshotLines) {
      output.push(`- ${line}`);
    }
  }

  for (const group of orderGroupsForRender(structure.groups)) {
    const matchedEntries = isOtherGroupTitle(group.title)
      ? entries.filter((entry) => !assignedEntryIds.has(entry.id))
      : resolveGroupEntries(group, entries, candidates, candidatesByRef);
    const primaryLink = choosePrimaryGroupLink(group, matchedEntries, candidatesByRef);
    const secondaryLink = chooseSecondaryGroupLink(group, matchedEntries, primaryLink);
    const visibleItems = buildVisibleGroupItems(group, matchedEntries, primaryLink);

    if (!visibleItems.length) {
      continue;
    }

    if (!isOtherGroupTitle(group.title)) {
      matchedEntries.forEach((entry) => assignedEntryIds.add(entry.id));
    }

    output.push(buildCompactHeading(group.title, primaryLink, secondaryLink));

    for (const item of visibleItems) {
      output.push(`- ${compressRenderedItemText(item, group.title)}`);
    }
  }

  if (needsReviewItems.length) {
    output.push(renderSectionTitle("Needs review"));
    for (const line of needsReviewItems) {
      if (line.url) {
        output.push(`- <${line.url}|${escapeSlackLinkText(line.text)}>`);
      } else {
        output.push(`- ${line.text}`);
      }
    }
  }

  if (structure.blockers.length) {
    output.push(renderSectionTitle("Blockers"));
    for (const line of structure.blockers) {
      output.push(`- ${line}`);
    }
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n");
}
