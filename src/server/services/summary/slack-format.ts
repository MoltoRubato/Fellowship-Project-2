import { EntrySource } from "@prisma/client";
import type { SummaryLogEntry } from "./types";
import { buildLinearTaskText } from "./task-processing";
import { getEntrySourceRef } from "./source-refs";

const TOP_LEVEL_BULLET_PATTERN = /^-\s+/;
const NESTED_BULLET_PATTERN = /^\s{2,}-\s+/;
const EXISTING_LINK_PATTERN = /<https?:\/\/[^|>]+\|[^>]+>|https?:\/\/\S+/i;
const REF_PATTERN = /\s*\[ref:([a-z0-9_]+)\]/gi;

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

function formatNestedLink(candidate: LinkCandidate) {
  const label =
    candidate.source === EntrySource.github_commit
      ? "commit"
      : candidate.source === EntrySource.github_pr
        ? "PR"
        : candidate.source === EntrySource.linear_issue
          ? "ticket"
          : "link";

  return `<${candidate.url}|${label}>`;
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

  return lines.some((line) => TOP_LEVEL_BULLET_PATTERN.test(line));
}

export function renderSummaryForSlack(summary: string, entries: SummaryLogEntry[]) {
  const candidates = buildLinkCandidates(entries);
  const candidatesByRef = new Map(
    candidates
      .filter((candidate): candidate is LinkCandidate & { ref: string } => Boolean(candidate.ref))
      .map((candidate) => [candidate.ref, candidate]),
  );

  let inGroups = false;
  let section: "header" | "groups" | "next_up" | "blockers" = "header";

  return summary
    .split("\n")
    .map((rawLine) => {
      const refs = extractRefs(rawLine);
      const cleanedLine = stripRefs(rawLine);
      const trimmed = cleanedLine.trim();

      if (!trimmed) {
        return "";
      }

      if (/^Next up:\s*$/i.test(trimmed)) {
        section = "next_up";
        return "Next up:";
      }

      if (/^Blockers:\s*$/i.test(trimmed)) {
        section = "blockers";
        return "Blockers:";
      }

      if (TOP_LEVEL_BULLET_PATTERN.test(cleanedLine)) {
        if (section === "header") {
          inGroups = true;
          section = "groups";
        }

        if (section === "groups") {
          const text = trimmed.replace(TOP_LEVEL_BULLET_PATTERN, "").trim();
          if (!text) {
            return "";
          }

          if (hasExistingLink(text)) {
            return `• ${text}`;
          }

          const [exact] = buildExactCandidates(refs, candidatesByRef, "group");
          const heuristic = exact ? null : findCandidate(text, candidates, "group");
          const candidate = exact ?? heuristic;

          if (candidate) {
            return `• <${candidate.url}|${escapeSlackLinkText(text)}>`;
          }

          return `• ${text}`;
        }

        return `• ${trimmed.replace(TOP_LEVEL_BULLET_PATTERN, "").trim()}`;
      }

      if (NESTED_BULLET_PATTERN.test(cleanedLine)) {
        const text = cleanedLine.replace(NESTED_BULLET_PATTERN, "").trim();
        if (!text) {
          return "";
        }

        if (hasExistingLink(text)) {
          return `  ◦ ${text}`;
        }

        const exact = buildExactCandidates(refs, candidatesByRef, "item");
        const heuristic = exact.length ? [] : (() => {
          const candidate = findCandidate(text, candidates, "item");
          return candidate ? [candidate] : [];
        })();
        const matched = exact.length ? exact : heuristic;

        if (!matched.length) {
          return `  ◦ ${text}`;
        }

        return `  ◦ ${text} ${matched.map((candidate) => formatNestedLink(candidate)).join(" ")}`.trimEnd();
      }

      if (!inGroups) {
        return trimmed;
      }

      return trimmed;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}
