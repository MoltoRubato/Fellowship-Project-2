import { EntrySource } from "@prisma/client";
import type { SummaryLogEntry } from "./types";
import { buildLinearTaskText } from "./task-processing";
import { getEntrySourceRef } from "./source-refs";
import { dedupeLinkedBulletLines } from "./dedupe-linked-bullets";

const BULLET_LINE_PATTERN = /^\s*(?:[-•]\s+|\d+[.)]\s+)/;
const EXISTING_LINK_PATTERN = /<https?:\/\/[^|>]+\|[^>]+>|https?:\/\/\S+/i;
const TRAILING_LINK_SUFFIX_PATTERN = /(?:\s-\s(?:<https?:\/\/[^|>]+\|[^>]+>|https?:\/\/\S+|Link))+$/i;
const EMBEDDED_REF_PATTERN = /\s*\[ref:([a-z0-9_]+)\]/gi;

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

function extractUrlFromLine(line: string) {
  const match = line.match(EXISTING_LINK_PATTERN);
  const token = match?.[0];

  if (!token) {
    return null;
  }

  if (token.startsWith("<")) {
    const url = token.slice(1).split("|")[0]?.trim();
    return url || null;
  }

  return token.trim();
}

function stripEmbeddedRefs(line: string) {
  return line.replace(EMBEDDED_REF_PATTERN, "").replace(/\s{2,}/g, " ").trimEnd();
}

function extractEmbeddedRefs(line: string) {
  const refs = new Set<string>();
  for (const match of line.matchAll(EMBEDDED_REF_PATTERN)) {
    const ref = match[1]?.trim().toLowerCase();
    if (ref) {
      refs.add(ref);
    }
  }

  return [...refs];
}

function stripTrailingLinkSuffixes(line: string) {
  return stripEmbeddedRefs(
    line
      .replace(/\s-\s<https?:\/\/[^>]*\.\.\.\s*$/i, "")
      .replace(/\s<https?:\/\/[^>]*\.\.\.\s*$/i, "")
      .replace(TRAILING_LINK_SUFFIX_PATTERN, "")
      .trimEnd(),
  );
}

function stripConventionalCommitPrefix(value: string) {
  return value.replace(/^(feat|fix|refactor|chore|docs|style|test|perf)(\([^)]+\))?!?:\s*/i, "").trim();
}

function buildLinearAliases(entry: SummaryLogEntry) {
  const aliases = [entry.title ?? "", entry.content, buildLinearTaskText(entry).replace(/^Linear:\s*/, "")];
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

function findCandidateUrls(line: string, candidates: LinkCandidate[]) {
  const refs = extractEmbeddedRefs(line);
  if (refs.length) {
    const urls = refs
      .map((ref) => candidates.find((candidate) => candidate.ref === ref)?.url ?? null)
      .filter((url, index, all): url is string => Boolean(url) && all.indexOf(url) === index);

    if (urls.length) {
      return urls;
    }
  }

  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(line, candidate),
    }))
    .filter((item) => item.score >= 0.62)
    .sort((left, right) => right.score - left.score);

  if (!scored.length) {
    return [];
  }

  const best = scored[0]!;
  const second = scored[1];
  if (second && best.score - second.score < 0.08) {
    return [];
  }

  return [best.candidate.url];
}

function appendUrlsToLine(line: string, urls: string[]) {
  if (!urls.length) {
    return line;
  }

  return `${line}${urls.map((url) => ` - <${url}|Link>`).join("")}`;
}

export function appendMissingSourceLinks(summary: string, entries: SummaryLogEntry[]) {
  const candidates = buildLinkCandidates(entries);
  if (!candidates.length) {
    return summary;
  }

  return dedupeLinkedBulletLines(
    summary
    .split("\n")
    .map((line) => {
      const existingUrl = extractUrlFromLine(line);
      const cleanedLine = stripTrailingLinkSuffixes(line);
      const trimmed = cleanedLine.trim();
      if (!BULLET_LINE_PATTERN.test(trimmed)) {
        return cleanedLine;
      }

      if (existingUrl) {
        return appendUrlsToLine(cleanedLine, [existingUrl]);
      }

      return appendUrlsToLine(cleanedLine, findCandidateUrls(cleanedLine, candidates));
    }),
  )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}
