import { type Account } from "@prisma/client";
import { decrypt } from "@/lib/crypto";
import type { GithubActivityItem, GithubVisibleRepo, GithubConnectionSnapshot } from "./types";
import { createGithubClient, parseScopeHeader, buildPermissionWarning, getGithubAccount } from "./client";

async function loadGithubReposFromAccount(account: Account) {
  const token = decrypt(account.accessToken);
  const octokit = createGithubClient(token);

  const viewer = await octokit.request("GET /user");
  const scopes = parseScopeHeader(String(viewer.headers["x-oauth-scopes"] ?? ""));

  const repos = await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
    per_page: 100,
    sort: "updated",
    affiliation: "owner,collaborator,organization_member",
  });

  const visibleRepos: GithubVisibleRepo[] = repos.map((repo) => ({
    id: String(repo.id),
    nameWithOwner: repo.full_name,
    url: repo.html_url,
    isPrivate: repo.private,
    visibility: repo.visibility ?? (repo.private ? "private" : "public"),
    updatedAt: repo.updated_at ?? null,
  }));

  return {
    repos: visibleRepos,
    scopes,
    username: account.username,
  };
}

export async function getGithubConnectionSnapshot(userId: string): Promise<GithubConnectionSnapshot> {
  const account = await getGithubAccount(userId);
  if (!account) {
    return {
      connected: false,
      username: null,
      scopes: [],
      permissionWarning: null,
      repos: [],
    };
  }

  const { repos, scopes, username } = await loadGithubReposFromAccount(account);

  return {
    connected: true,
    username,
    scopes,
    permissionWarning: buildPermissionWarning(scopes),
    repos,
  };
}

export async function fetchGithubActivity(
  account: Account,
  since: Date,
  repoFilter?: string | null,
) {
  const username = account.username;
  if (!username) {
    return [] as GithubActivityItem[];
  }

  const token = decrypt(account.accessToken);
  const octokit = createGithubClient(token);
  const results: GithubActivityItem[] = [];

  const response = await octokit.request("GET /users/{username}/events", {
    username,
    per_page: 100,
  });

  for (const event of response.data) {
    const payload = event.payload as {
      commits?: Array<{ sha: string; message: string }>;
      pull_request?: { id: number; title: string; html_url: string };
      action?: string;
      before?: string;
      head?: string;
    };
    const createdAt = event.created_at ? new Date(event.created_at) : null;
    if (!createdAt || createdAt < since) {
      continue;
    }

    const repoName = event.repo?.name;
    if (!repoName) {
      continue;
    }

    if (repoFilter && repoName.toLowerCase() !== repoFilter.toLowerCase()) {
      continue;
    }

    if (event.type === "PushEvent") {
      let commits = payload.commits ?? [];

      // GitHub Events API sometimes omits commits from PushEvent payloads.
      // Fall back to the compare API to retrieve them.
      if (commits.length === 0 && payload.before && payload.head) {
        try {
          const [owner, repo] = repoName.split("/");
          const compare = await octokit.request(
            "GET /repos/{owner}/{repo}/compare/{basehead}",
            { owner, repo, basehead: `${payload.before}...${payload.head}` },
          );
          commits = compare.data.commits.map((c: { sha: string; commit: { message: string } }) => ({
            sha: c.sha,
            message: c.commit.message,
          }));
        } catch {
          // Compare may fail for force-pushes or deleted refs — skip silently
        }
      }

      for (const commit of commits) {
        const message = commit.message.split("\n")[0]?.trim();
        if (!message || message.startsWith("Merge")) {
          continue;
        }

        results.push({
          repo: repoName,
          title: message,
          content: `Commit to ${repoName}: ${message}`,
          source: "github_commit",
          externalId: `github-commit:${repoName}:${commit.sha}`,
          externalUrl: `https://github.com/${repoName}/commit/${commit.sha}`,
          createdAt,
        });
      }
    }

    if (event.type === "PullRequestEvent") {
      const pullRequest = payload.pull_request;
      if (!pullRequest?.id || !pullRequest.title) {
        continue;
      }

      const action = payload.action ?? "updated";
      results.push({
        repo: repoName,
        title: pullRequest.title,
        content: `PR ${action} in ${repoName}: ${pullRequest.title}`,
        source: "github_pr",
        externalId: `github-pr:${pullRequest.id}:${action}`,
        externalUrl: pullRequest.html_url,
        createdAt,
      });
    }
  }

  return results.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}
