import type { SummaryLogEntry, SummaryPeriod, SummaryAnswer } from "./types";
import { fetchGithubCommitDetails } from "@/server/services/integrations/github";
import { parseCommitEntry, buildCommitPromptItems, buildTaskItems, buildBlockerItems } from "./task-processing";
import { runAiSummary } from "./ai";
import { buildFallbackSummary } from "./fallback";

const BULLET_LINE_PATTERN = /^\s*(?:[-•]\s+|\d+[.)]\s+)/;
const EXISTING_LINK_PATTERN = /<https?:\/\/[^|>]+\|[^>]+>/i;

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

function parseCommitSha(externalId?: string | null) {
  if (!externalId?.startsWith("github-commit:")) {
    return null;
  }

  const raw = externalId.slice("github-commit:".length);
  const separator = raw.lastIndexOf(":");
  if (separator === -1) {
    return null;
  }

  const sha = raw.slice(separator + 1).trim();
  return sha || null;
}

function parsePullNumber(url?: string | null) {
  if (!url) {
    return null;
  }
  const match = url.match(/\/pull\/(\d+)(?:$|[/?#])/i);
  return match?.[1] ?? null;
}

function extractLinearTicket(title?: string | null) {
  if (!title) {
    return null;
  }
  const match = title.match(/\b[A-Z]{2,}-\d+\b/);
  return match?.[0] ?? null;
}

type LinkCandidate = {
  url: string;
  tokens: string[];
};

function buildLinkCandidates(entries: SummaryLogEntry[]): LinkCandidate[] {
  return entries
    .filter(
      (entry) =>
        Boolean(entry.externalUrl) &&
        (entry.source === "github_commit" || entry.source === "github_pr" || entry.source === "linear_issue"),
    )
    .map((entry) => {
      const sha = parseCommitSha(entry.externalId);
      const shortSha = sha ? sha.slice(0, 7) : null;
      const pullNumber = parsePullNumber(entry.externalUrl);
      const linearTicket = extractLinearTicket(entry.title);
      const repo = entry.project?.githubRepo ?? null;

      const rawTokens = [
        entry.title ?? "",
        entry.content ?? "",
        repo ?? "",
        sha ?? "",
        shortSha ?? "",
        pullNumber ? `#${pullNumber}` : "",
        pullNumber ?? "",
        linearTicket ?? "",
      ];

      const tokens = rawTokens
        .map(normalizeText)
        .filter((token, index, array) => token.length >= 4 && array.indexOf(token) === index);

      return {
        url: entry.externalUrl as string,
        tokens,
      };
    });
}

function appendMissingSourceLinks(summary: string, entries: SummaryLogEntry[]) {
  const candidates = buildLinkCandidates(entries);
  if (!candidates.length) {
    return summary;
  }

  const lines = summary.split("\n");
  const updated = lines.map((line) => {
    const trimmed = line.trim();
    if (!BULLET_LINE_PATTERN.test(trimmed)) {
      return line;
    }
    if (EXISTING_LINK_PATTERN.test(line)) {
      return line;
    }

    const normalizedLine = normalizeText(trimmed);
    if (!normalizedLine) {
      return line;
    }

    const match = candidates.find((candidate) =>
      candidate.tokens.some((token) => normalizedLine.includes(token) || token.includes(normalizedLine)),
    );

    if (!match) {
      return line;
    }

    return `${line} - <${match.url}|Link>`;
  });

  return updated.join("\n");
}

export function getSummaryWindow(period: SummaryPeriod) {
  if (period === "week") {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    now.setDate(now.getDate() + diff);
    return now;
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

export async function generateStandupSummary(input: {
  userId: string;
  period: SummaryPeriod;
  updateNo: number;
  entries: SummaryLogEntry[];
  blockers: SummaryLogEntry[];
  answers?: SummaryAnswer[];
}) {
  const commitLookups = input.entries
    .map((entry) => parseCommitEntry(entry))
    .filter((entry): entry is NonNullable<ReturnType<typeof parseCommitEntry>> => Boolean(entry));
  const commitDetails = await fetchGithubCommitDetails(input.userId, commitLookups);
  const blockers = buildBlockerItems(input.blockers);
  const commits = buildCommitPromptItems(commitDetails);
  const tasks = buildTaskItems(input.entries);

  const aiResult = await runAiSummary({
    userId: input.userId,
    period: input.period,
    updateNo: input.updateNo,
    blockers,
    commits,
    tasks,
    commitDetails,
    answers: input.answers ?? [],
  });

  if (aiResult?.summary) {
    return {
      ...aiResult,
      summary: appendMissingSourceLinks(aiResult.summary, input.entries),
    };
  }

  if (aiResult) {
    return aiResult;
  }

  const fallback = buildFallbackSummary({
    updateNo: input.updateNo,
    period: input.period,
    entries: input.entries,
    blockers: input.blockers,
  });

  if (!fallback.summary) {
    return fallback;
  }

  return {
    ...fallback,
    summary: appendMissingSourceLinks(fallback.summary, input.entries),
  };
}
