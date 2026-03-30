import { EntrySource, type LogEntry, type Project } from "@prisma/client";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { fetchGithubCommitDetails, type GithubCommitDetail } from "@/server/services/github";

type SummaryLogEntry = LogEntry & {
  project: Project | null;
};

export type SummaryPeriod = "today" | "week";

export interface SummaryQuestion {
  message: string;
  options: string[];
}

export interface SummaryAnswer {
  message: string;
  answer: string;
}

export interface SummaryGenerationResult {
  summary: string | null;
  questions: SummaryQuestion[];
  requestCommits: string[];
  mode: "ai" | "fallback";
}

interface ParsedSummaryResponse {
  summary: string | null;
  questions: SummaryQuestion[];
  requestCommits: string[];
  mode: "ai";
}

interface CommitPromptItem {
  commit_message: string;
  authors: string[];
  commit_id: string;
}

interface TaskPromptItem {
  task: string;
  status_hint: "completed" | "in_progress" | "unknown";
  source: "manual" | "dm" | "github_pr" | "linear_issue";
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
  "todo",
];
const LOW_SIGNAL_TASK_PATTERN = /^(hi|hello|hey|yo|sup|test|testing)$/i;
const COMPLETED_HINT_PATTERN =
  /\b(done|finished|completed|fixed|added|implemented|shipped|merged|resolved|polished|reviewed)\b/i;

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

function dedupeOrderedLines(lines: string[]) {
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

function cleanYamlPayload(text: string) {
  return text
    .replace(/^```yaml\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function looksInProgress(text: string) {
  const lower = text.toLowerCase();
  return IN_PROGRESS_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function getTaskStatusHint(text: string): TaskPromptItem["status_hint"] {
  if (COMPLETED_HINT_PATTERN.test(text)) {
    return "completed";
  }

  if (looksInProgress(text)) {
    return "in_progress";
  }

  return "unknown";
}

function truncateLine(text: string, max = 100) {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, max - 3))}...`;
}

function parseCommitEntry(entry: SummaryLogEntry) {
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

function buildCommitPromptItems(commitDetails: GithubCommitDetail[]): CommitPromptItem[] {
  return commitDetails
    .slice()
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
    .map((commit) => ({
      commit_message: commit.message,
      authors: commit.authors,
      commit_id: commit.sha,
    }));
}

function buildTaskItems(entries: SummaryLogEntry[]) {
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
          ? `Linear: ${entry.title ?? entry.content}`
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
      status_hint: getTaskStatusHint(task),
      source:
        entry.source === EntrySource.dm
          ? "dm"
          : entry.source === EntrySource.github_pr
            ? "github_pr"
            : entry.source === EntrySource.linear_issue
              ? "linear_issue"
              : "manual",
    });
  }

  return tasks;
}

function buildBlockerItems(blockers: SummaryLogEntry[]) {
  return dedupeOrderedLines(
    blockers
      .slice()
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((entry) => entry.content),
  );
}

function normaliseQuestionOptions(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .map((option) => String(option ?? "").trim())
    .filter(Boolean);
}

function parseSummaryResponse(text: string): ParsedSummaryResponse {
  const parsed = parseYaml(cleanYamlPayload(text)) as {
    summary?: unknown;
    questions?: unknown;
    request_commits?: unknown;
  };

  const questions = Array.isArray(parsed?.questions)
    ? parsed.questions
        .map((question) => {
          const candidate = question as { message?: unknown; options?: unknown };
          const message = String(candidate?.message ?? "").trim();
          if (!message) {
            return null;
          }

          return {
            message,
            options: normaliseQuestionOptions(candidate?.options),
          };
        })
        .filter((question): question is SummaryQuestion => Boolean(question))
    : [];

  const requestCommits = Array.isArray(parsed?.request_commits)
    ? parsed.request_commits.map((value) => String(value ?? "").trim()).filter(Boolean)
    : [];

  const summaryValue = typeof parsed?.summary === "string" ? parsed.summary.trim() : null;

  return {
    summary: summaryValue || null,
    questions,
    requestCommits,
    mode: "ai",
  };
}

function formatAnswersForPrompt(answers: SummaryAnswer[]) {
  return stringifyYaml(
    answers.map((answer) => ({
      question: answer.message,
      answer: answer.answer,
    })),
  ).trim();
}

function formatCommitDetailsForPrompt(commitDetails: GithubCommitDetail[]) {
  return stringifyYaml(
    commitDetails.map((commit) => ({
      repo: commit.repo,
      commit_id: commit.sha,
      commit_message: commit.message,
      authors: commit.authors,
      files: commit.files.slice(0, 8).map((file) => ({
        filename: file.filename,
        status: file.status ?? null,
        patch: file.patch ? truncateLine(file.patch, 800) : null,
      })),
    })),
  ).trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildAiPrompt(input: {
  updateNo: number;
  blockers: string[];
  commits: CommitPromptItem[];
  tasks: TaskPromptItem[];
  period: SummaryPeriod;
  answers: SummaryAnswer[];
  requestedCommitDetails: GithubCommitDetail[];
}) {
  const workLabel = input.period === "week" ? "this week's" : "today's";
  const summaryLabel = input.period === "week" ? "This week's work:" : "Today's work:";
  const promptValues = stringifyYaml({
    update_no: input.updateNo,
    blockers: input.blockers,
    commits: input.commits,
    tasks: input.tasks,
  }).trim();

  const sections = [
    "Use the following values:",
    "",
    promptValues,
    "",
    `I want you to generate a quick summary of ${workLabel} work as a Slack message.`,
    "",
    "These are passed in ascending order of when they were noted/comitted.",
    "",
    "Each task may include a status_hint. You may trust explicit completed or in_progress hints when the wording is direct.",
    "",
    "You must analyse these commit messages and identify tasks that have been completed and tasks that are in progress. If you are unsure, you may ask questions specified later below in this message. DO NOT take a guess as to what's completed or in progress if unsure.",
    "",
    "The final note should be formatted as such:",
    "",
    `Update #${input.updateNo}`,
    "",
    summaryLabel,
    "",
    "- Fixed Facebook oauth2 raising missing read scope errors.",
    "",
    "- Sped up table search queries from 1~2 seconds to 50ms.",
    "",
    "- Polished left dashboard buttons.",
    "",
    "In progress:",
    "",
    "- Adding Linear as a supported integration.",
    "",
    "Blockers:",
    "",
    "- Was set back by a misconfigured Facebook oauth setting.",
    "",
    "- Awaiting on the design team for a final mockup of the home page.",
    "",
    "Do not change the update number and today's date.",
    "",
    "Only include the In progress: and/or Blockers: section if there is any.",
    "",
    "Each dot point must be strictly 100 characters or less, but aim for 50 or less.",
    "",
    "You must ask any clarifying questions until you are 100% certain on what tasks are still in progress and what tasks are done, and any other questions.",
    "",
    "You should also ask questions to ask and encourage the user any numeric descriptions (if the point makes sense to e.g. no need for design changes) such as the '1~2 seconds to 50ms' point. In the questions, write a suggested times and aspects of measurement by taking a guess by writing them as 'e.g. ...'",
    "",
    "ALL your responses in this context window MUST be outputted as the following yaml and nothing else outside of the yaml format. DO NOT add any additional text other than the format specified.",
    "",
    "You may assume that for questions, they will ALL have an additional option below for users to type their own response.",
    "",
    "If you are unsure of what a particular commit is about, you must ask to view the commit's code in the request_commits field below.",
    "",
    "e.g. No summary yet, and instead has follow up questions:",
    "",
    "summary: null",
    "",
    "questions:",
    "",
    '- message: "What measureable improvements were made for speeding up the table search queries? e.g. sped up from 1~2 seconds to 50ms?"',
    "",
    "  options:",
    "",
    '  - "From 1~2 seconds to 50ms"',
    "",
    '  - "No measureable improvements known"',
    "",
    '- message: "Is adding Linear as a supported integration still in-progress or completed?"',
    "",
    "  options:",
    "",
    '  - "In progress"',
    "",
    '  - "Completed"',
    "",
    '  - "Abandoned"',
    "",
    "request_commits: [03e34d545967cba4f6ba0b7fe42cc5affbd2c2db]",
    "",
    "e.g. Has summary, with no more follow up questions and no commits to view:",
    "",
    "summary: |",
    "",
    `  Update #${input.updateNo}`,
    "",
    `  ${summaryLabel}`,
    "",
    "  - Fixed Facebook oauth2 raising missing read scope errors.",
    "",
    "  - Sped up table search queries from 1~2 seconds to 50ms.",
    "",
    "  - Polished left dashboard buttons.",
    "",
    "  In progress:",
    "",
    "  - Adding Linear as a supported integration.",
    "",
    "  Blockers:",
    "",
    "  - Was set back by a misconfigured Facebook oauth setting.",
    "",
    "  - Awaiting on the design team for a final mockup of the home page.",
    "",
    "questions:",
    "",
    "request_commits:",
  ];

  if (input.answers.length) {
    sections.push(
      "",
      "The user has provided these answers to your questions:",
      "",
      formatAnswersForPrompt(input.answers),
    );
  }

  if (input.requestedCommitDetails.length) {
    sections.push(
      "",
      "Here are the commit(s) you requested to view:",
      "",
      formatCommitDetailsForPrompt(input.requestedCommitDetails),
    );
  }

  return sections.join("\n");
}

function buildFallbackSummary(input: {
  updateNo: number;
  period: SummaryPeriod;
  entries: SummaryLogEntry[];
  blockers: SummaryLogEntry[];
}): SummaryGenerationResult {
  const completed: string[] = [];
  const inProgress: string[] = [];

  for (const entry of input.entries) {
    if (entry.source === EntrySource.github_commit || entry.source === EntrySource.github_pr) {
      completed.push(entry.title ?? entry.content);
      continue;
    }

    if (entry.entryType === "blocker") {
      continue;
    }

    if (LOW_SIGNAL_TASK_PATTERN.test(entry.content.trim())) {
      continue;
    }

    if (looksInProgress(entry.content)) {
      inProgress.push(entry.content);
    } else {
      completed.push(entry.content);
    }
  }

  const workLabel = input.period === "week" ? "This week's work:" : "Today's work:";
  const blockerLines = dedupeOrderedLines(input.blockers.map((entry) => truncateLine(entry.content)));
  const completedLines = dedupeOrderedLines(completed.map((line) => truncateLine(line)));
  const inProgressLines = dedupeOrderedLines(inProgress.map((line) => truncateLine(line)));

  const lines = [`Update #${input.updateNo}`, "", workLabel];
  for (const line of completedLines.length ? completedLines : ["No completed work logged."]) {
    lines.push(`- ${line}`);
  }

  if (inProgressLines.length) {
    lines.push("", "In progress:");
    for (const line of inProgressLines) {
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

async function runAiSummary(input: {
  userId: string;
  period: SummaryPeriod;
  updateNo: number;
  blockers: string[];
  commits: CommitPromptItem[];
  tasks: TaskPromptItem[];
  commitDetails: GithubCommitDetail[];
  answers: SummaryAnswer[];
}) {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const modelName = process.env.GOOGLE_AI_MODEL ?? "gemini-2.5-flash";
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: modelName,
  });

  let requestedCommitDetails: GithubCommitDetail[] = [];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const prompt = buildAiPrompt({
      updateNo: input.updateNo,
      blockers: input.blockers,
      commits: input.commits,
      tasks: input.tasks,
      period: input.period,
      answers: input.answers,
      requestedCommitDetails,
    });

    try {
      const response = await model.generateContent(prompt);
      const parsed = parseSummaryResponse(response.response.text());
      const unseenRequestedCommits = parsed.requestCommits.filter(
        (sha) => input.commitDetails.some((commit) => commit.sha === sha) && !requestedCommitDetails.some((commit) => commit.sha === sha),
      );

      if (unseenRequestedCommits.length) {
        requestedCommitDetails = [
          ...requestedCommitDetails,
          ...input.commitDetails.filter((commit) => unseenRequestedCommits.includes(commit.sha)),
        ];
        continue;
      }

      return parsed;
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: unknown }).status) : null;
      if ((status === 429 || status === 503) && attempt < 2) {
        await sleep(1500 * (attempt + 1));
        continue;
      }

      console.error("Gemini summary generation failed", {
        modelName,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  return null;
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

  if (aiResult) {
    return aiResult;
  }

  return buildFallbackSummary({
    updateNo: input.updateNo,
    period: input.period,
    entries: input.entries,
    blockers: input.blockers,
  });
}
