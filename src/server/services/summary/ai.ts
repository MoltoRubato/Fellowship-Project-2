import { GoogleGenerativeAI } from "@google/generative-ai";
import type { SummaryPeriod, SummaryAnswer, CommitPromptItem, TaskPromptItem, ParsedSummaryResponse } from "./types";
import type { GithubCommitDetail } from "@/server/services/integrations/github";
import { buildAiPrompt } from "./prompt";
import { parseSummaryResponse } from "./parser";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runAiSummary(input: {
  userId: string;
  period: SummaryPeriod;
  updateNo: number;
  blockers: string[];
  commits: CommitPromptItem[];
  tasks: TaskPromptItem[];
  commitDetails: GithubCommitDetail[];
  answers: SummaryAnswer[];
}): Promise<ParsedSummaryResponse | null> {
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
