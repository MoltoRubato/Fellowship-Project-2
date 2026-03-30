import { decrypt } from "@/lib/crypto";
import type { GithubCommitLookup, GithubCommitDetail } from "./types";
import { createGithubClient, getGithubAccount } from "./client";

export async function fetchGithubCommitDetails(
  userId: string,
  commits: GithubCommitLookup[],
): Promise<GithubCommitDetail[]> {
  if (!commits.length) {
    return [];
  }

  const account = await getGithubAccount(userId);
  if (!account) {
    return commits.map((commit) => ({
      repo: commit.repo,
      sha: commit.sha,
      message: commit.message,
      authors: [],
      createdAt: commit.createdAt,
      files: [],
    }));
  }

  const token = decrypt(account.accessToken);
  const octokit = createGithubClient(token);
  const results: GithubCommitDetail[] = [];

  for (const commit of commits) {
    const [owner, repo] = commit.repo.split("/");
    if (!owner || !repo) {
      results.push({
        repo: commit.repo,
        sha: commit.sha,
        message: commit.message,
        authors: account.username ? [account.username] : [],
        createdAt: commit.createdAt,
        files: [],
      });
      continue;
    }

    try {
      const response = await octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: commit.sha,
      });
      const authors = [
        response.data.author?.login,
        response.data.commit.author?.name,
        response.data.commit.committer?.name,
      ].filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index);

      results.push({
        repo: commit.repo,
        sha: commit.sha,
        message: response.data.commit.message.split("\n")[0]?.trim() || commit.message,
        authors,
        createdAt: commit.createdAt,
        files: (response.data.files ?? []).map((file) => ({
          filename: file.filename,
          status: file.status,
          patch: file.patch ?? null,
        })),
      });
    } catch {
      results.push({
        repo: commit.repo,
        sha: commit.sha,
        message: commit.message,
        authors: account.username ? [account.username] : [],
        createdAt: commit.createdAt,
        files: [],
      });
    }
  }

  return results;
}
