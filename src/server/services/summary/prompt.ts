import { readFileSync } from "fs";
import { dirname, join } from "path";
import { stringify as stringifyYaml } from "yaml";
import type { SummaryPeriod, SummaryAnswer, CommitPromptItem, TaskPromptItem } from "./types";
import { truncateLine } from "./task-processing";
import type { GithubCommitDetail } from "@/server/services/integrations/github";
import { fileURLToPath } from "url";

// Convert import.meta.url to __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const promptTemplate = readFileSync(join(__dirname, "prompt.md"), "utf-8");
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

export function buildAiPrompt(input: {
  updateNo: number;
  blockers: string[];
  commits: CommitPromptItem[];
  tasks: TaskPromptItem[];
  period: SummaryPeriod;
  answers: SummaryAnswer[];
  requestedCommitDetails: GithubCommitDetail[];
}) {
  const workLabel = input.period === "week" ? "this week's" : "today's";
  const headerLabel = input.period === "week"
    ? "Weekly update :male-technologist::"
    : "Daily update :male-technologist::";
  const promptValues = stringifyYaml({
    update_no: input.updateNo,
    blockers: input.blockers,
    commits: input.commits,
    tasks: input.tasks,
  }).trim();

  let prompt = promptTemplate
    .replaceAll("{{PROMPT_VALUES}}", promptValues)
    .replaceAll("{{WORK_LABEL}}", workLabel)
    .replaceAll("{{HEADER_LABEL}}", headerLabel)
    .replaceAll("{{UPDATE_NO}}", String(input.updateNo));

  if (input.answers.length) {
    prompt +=
      "\n\nThe user has provided these answers to your questions:\n\n" +
      formatAnswersForPrompt(input.answers);
  }

  if (input.requestedCommitDetails.length) {
    prompt +=
      "\n\nHere are the commit(s) you requested to view:\n\n" +
      formatCommitDetailsForPrompt(input.requestedCommitDetails);
  }

  return prompt;
}
