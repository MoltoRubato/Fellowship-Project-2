import type { LogEntry, Project } from "@prisma/client";

export type SummaryLogEntry = LogEntry & {
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

export interface ParsedSummaryResponse {
  summary: string | null;
  questions: SummaryQuestion[];
  requestCommits: string[];
  mode: "ai";
}

export interface CommitPromptItem {
  commit_message: string;
  authors: string[];
  commit_id: string;
  commit_url: string;
}

export interface TaskPromptItem {
  task: string;
  status_hint: "completed" | "in_progress" | "unknown";
  source: "manual" | "dm" | "github_pr" | "linear_issue";
  link?: string | null;
}
