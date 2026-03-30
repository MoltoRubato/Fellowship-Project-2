import { EntrySource, type LogEntry, type Project } from "@prisma/client";
import { GoogleGenerativeAI } from "@google/generative-ai";

type SummaryLogEntry = LogEntry & {
  project: Project | null;
};

type SummaryPeriod = "today" | "week";

interface SummaryAnalysis {
  headline: string;
  completed: string[];
  inProgress: string[];
}

const IN_PROGRESS_KEYWORDS = [
  "in progress",
  "wip",
  "ongoing",
  "pending",
  "waiting",
  "blocked",
  "need",
  "follow up",
];

function dedupeLines(lines: string[]) {
  return [...new Set(lines.map((line) => line.trim()).filter(Boolean))];
}

function cleanJsonPayload(text: string) {
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function looksInProgress(text: string) {
  const lower = text.toLowerCase();
  return IN_PROGRESS_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function formatLinkedSlackText(text: string, url?: string | null) {
  return url ? `<${url}|${text}>` : text;
}

function dateLabel(date: Date) {
  return date.toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function timeLabel(date: Date) {
  return date.toLocaleTimeString("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getSummaryWindow(period: SummaryPeriod) {
  if (period === "week") {
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    const day = now.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    now.setUTCDate(now.getUTCDate() + diff);
    return now;
  }

  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now;
}

function buildFallbackAnalysis(entries: SummaryLogEntry[]): SummaryAnalysis {
  const completed: string[] = [];
  const inProgress: string[] = [];

  for (const entry of entries) {
    if (entry.source === EntrySource.github_commit || entry.source === EntrySource.github_pr || entry.source === EntrySource.linear_issue) {
      completed.push(entry.content);
      continue;
    }

    if (looksInProgress(entry.content)) {
      inProgress.push(entry.content);
    } else {
      completed.push(entry.content);
    }
  }

  const uniqueCompleted = dedupeLines(completed).slice(0, 6);
  const uniqueInProgress = dedupeLines(inProgress).slice(0, 4);

  return {
    headline:
      uniqueCompleted[0] ??
      uniqueInProgress[0] ??
      "Made progress across standup updates and external activity",
    completed: uniqueCompleted,
    inProgress: uniqueInProgress,
  };
}

async function buildAiAnalysis(entries: SummaryLogEntry[], period: SummaryPeriod) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: "gemini-1.5-flash",
  });

  const rawEntries = entries.map((entry) => ({
    text: entry.content,
    source: entry.source,
    repo: entry.project?.githubRepo ?? null,
    createdAt: entry.createdAt.toISOString(),
  }));

  const prompt = [
    "You write short engineering standup summaries.",
    `Summarise the following ${period} entries.`,
    "Return JSON only with this shape:",
    '{"headline":"string","completed":["string"],"inProgress":["string"]}',
    "Rules:",
    "- Do not invent details.",
    "- Keep headline to one sentence under 120 characters.",
    "- completed should have at most 6 bullets.",
    "- inProgress should have at most 4 bullets.",
    "- Prefer grouped, concise summaries over repeating raw commit text.",
    "- GitHub and Linear items may contribute to completed or inProgress if clearly unfinished.",
    "",
    JSON.stringify(rawEntries, null, 2),
  ].join("\n");

  try {
    const response = await model.generateContent(prompt);
    const text = cleanJsonPayload(response.response.text());
    const parsed = JSON.parse(text) as SummaryAnalysis;

    return {
      headline: parsed.headline?.trim() || null,
      completed: dedupeLines(parsed.completed ?? []).slice(0, 6),
      inProgress: dedupeLines(parsed.inProgress ?? []).slice(0, 4),
    };
  } catch {
    return null;
  }
}

export async function generateStandupSummary(input: {
  userName: string;
  period: SummaryPeriod;
  entries: SummaryLogEntry[];
  blockers: SummaryLogEntry[];
  generatedAt?: Date;
}) {
  const generatedAt = input.generatedAt ?? new Date();
  const analysis = (await buildAiAnalysis(input.entries, input.period)) ?? buildFallbackAnalysis(input.entries);

  const completed = analysis.completed.length ? analysis.completed : ["No completed work logged"];
  const inProgress = analysis.inProgress.length ? analysis.inProgress : ["Nothing ongoing"];

  const githubActivity = input.entries
    .filter((entry) => entry.source === EntrySource.github_commit || entry.source === EntrySource.github_pr)
    .map((entry) => formatLinkedSlackText(entry.content, entry.externalUrl));

  const linearActivity = input.entries
    .filter((entry) => entry.source === EntrySource.linear_issue)
    .map((entry) => formatLinkedSlackText(entry.content, entry.externalUrl));

  const blockerLines = input.blockers.map((entry) => entry.content);

  const heading = `📋 *Standup Summary — ${input.userName} | ${dateLabel(generatedAt)}*`;
  const footer = `_Generated ${dateLabel(generatedAt)} at ${timeLabel(generatedAt)} UTC${
    input.period === "week" ? " · Weekly view" : ""
  }_`;

  const lines = [
    heading,
    analysis.headline,
    "",
    "*Completed:*",
    ...completed.map((line) => `• ${line}`),
    "",
    "*In progress:*",
    ...inProgress.map((line) => `• ${line}`),
    "",
    "*Blockers:*",
    ...(blockerLines.length ? blockerLines.map((line) => `🚧 ${line}`) : ["None"]),
    "",
    "*GitHub activity:*",
    ...(githubActivity.length ? githubActivity.map((line) => `• ${line}`) : ["• None"]),
    "",
    "*Linear activity:*",
    ...(linearActivity.length ? linearActivity.map((line) => `• ${line}`) : ["• None"]),
    "",
    footer,
  ];

  return lines.join("\n");
}
