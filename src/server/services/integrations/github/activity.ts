import { type Account } from "@prisma/client";
import { decrypt } from "@/lib/crypto";
import type {
  GithubActivityItem,
  GithubVisibleRepo,
  GithubConnectionSnapshot,
  GithubPullRequestMetadata,
} from "./types";
import { createGithubClient, parseScopeHeader, buildPermissionWarning, getGithubAccount } from "./client";
import { normalizeRepos } from "@/server/services/standup/repo";

type RepoFilterInput = string | string[] | null | undefined;

function normalizeRepoFilterInput(repoFilter?: RepoFilterInput) {
  return normalizeRepos(Array.isArray(repoFilter) ? repoFilter : [repoFilter]);
}

function matchesRepoFilter(repoName: string, repoFilters: string[]) {
  return repoFilters.length === 0 || repoFilters.includes(repoName.toLowerCase());
}

export function buildPullRequestContent(repo: string, title: string, status: "merged" | "closed" | "updated") {
  if (status === "merged") {
    return `PR merged in ${repo}: ${title}`;
  }

  if (status === "closed") {
    return `PR closed in ${repo}: ${title}`;
  }

  return `PR updated in ${repo}: ${title}`;
}

function buildPullRequestMetadata(input: {
  pullNumber: number;
  mergedAt?: string | null;
  state?: string | null;
  draft?: boolean | null;
  requestedReviewers?: Array<unknown> | null;
  requestedTeams?: Array<unknown> | null;
}): { githubPr: GithubPullRequestMetadata } {
  const state = input.mergedAt
    ? "closed"
    : input.state === "closed"
      ? "closed"
      : "open";
  const draft = Boolean(input.draft);
  const requestedReviewerCount = input.requestedReviewers?.length ?? 0;
  const requestedTeamCount = input.requestedTeams?.length ?? 0;
  const reviewRequested = requestedReviewerCount + requestedTeamCount > 0;

  return {
    githubPr: {
      number: input.pullNumber,
      state,
      draft,
      awaitingReview: state === "open" && !draft && reviewRequested,
      reviewRequested,
      requestedReviewerCount,
      requestedTeamCount,
    },
  };
}

export function getPullRequestStatus(input: {
  mergedAt?: string | null;
  closedAt?: string | null;
  updatedAt?: string | null;
  state?: string | null;
}) {
  if (input.mergedAt) {
    return {
      status: "merged" as const,
      createdAt: new Date(input.mergedAt),
    };
  }

  if (input.state === "closed") {
    const closedAt = input.closedAt ?? input.updatedAt ?? null;
    return {
      status: "closed" as const,
      createdAt: closedAt ? new Date(closedAt) : null,
    };
  }

  return {
    status: "updated" as const,
    createdAt: input.updatedAt ? new Date(input.updatedAt) : null,
  };
}

export function parseRepoFromApiUrl(url?: string | null) {
  if (!url) {
    return null;
  }

  const match = url.match(/\/repos\/([^/]+\/[^/]+)$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

export function buildPullRequestExternalId(
  repo: string,
  pullNumber: number,
  status: string,
  timestamp: string | null,
) {
  return `github-pr:${repo}:${pullNumber}:${status}:${timestamp ?? "unknown"}`;
}

export function getActivityDedupeKey(item: GithubActivityItem) {
  if (item.source === "github_pr" && item.externalUrl) {
    return `github-pr-url:${item.externalUrl}`;
  }

  return `github:${item.externalId}`;
}

export function getActivityPriority(item: GithubActivityItem) {
  if (item.source !== "github_pr") {
    return 0;
  }

  if (item.content.startsWith("PR merged")) {
    return 3;
  }

  if (item.content.startsWith("PR closed")) {
    return 2;
  }

  return 1;
}

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

async function loadRecentCommitActivity(account: Account, since: Date, repoFilter?: RepoFilterInput) {
  const token = decrypt(account.accessToken);
  const octokit = createGithubClient(token);
  const username = account.username?.toLowerCase();
  if (!username) {
    return [] as GithubActivityItem[];
  }
  const repoFilters = normalizeRepoFilterInput(repoFilter);
  const recentRepos = repoFilters.length
    ? repoFilters
        .map((repo) => {
          const [owner, repoName] = repo.split("/");
          return owner && repoName
            ? { ownerLogin: owner, name: repoName, full_name: repo }
            : null;
        })
        .filter(
          (
            repo,
          ): repo is {
            ownerLogin: string;
            name: string;
            full_name: string;
          } => Boolean(repo),
        )
    : (await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
        per_page: 100,
        sort: "updated",
        affiliation: "owner,collaborator,organization_member",
      })).filter((repo) => {
        const repoName = repo.full_name;
        if (!repoName) {
          return false;
        }

        if (!repo.updated_at) {
          return true;
        }

        return new Date(repo.updated_at) >= since;
      });

  const results: GithubActivityItem[] = [];

  for (const repo of recentRepos.slice(0, 25)) {
    const owner = "ownerLogin" in repo ? repo.ownerLogin : repo.owner?.login;
    const repoName = repo.name;
    const fullName = repo.full_name;
    if (!owner || !repoName || !fullName) {
      continue;
    }

    let commits: Awaited<ReturnType<typeof octokit.rest.repos.listCommits>>["data"] = [];

    try {
      const response = await octokit.rest.repos.listCommits({
        owner,
        repo: repoName,
        since: since.toISOString(),
        author: account.username ?? undefined,
        per_page: 20,
      });
      commits = response.data;
    } catch {
      continue;
    }

    for (const commit of commits) {
      const sha = commit.sha?.trim();
      const message = commit.commit.message.split("\n")[0]?.trim();
      const createdAtRaw = commit.commit.author?.date ?? commit.commit.committer?.date ?? null;
      const authorLogin = commit.author?.login?.toLowerCase() ?? null;
      const committerLogin = commit.committer?.login?.toLowerCase() ?? null;
      const createdAt = createdAtRaw ? new Date(createdAtRaw) : null;

      if (!sha || !message || !createdAt || createdAt < since || message.startsWith("Merge")) {
        continue;
      }

      if (authorLogin !== username && committerLogin !== username) {
        continue;
      }

      results.push({
        repo: fullName,
        title: message,
        content: `Commit to ${fullName}: ${message}`,
        source: "github_commit",
        externalId: `github-commit:${fullName}:${sha}`,
        externalUrl: commit.html_url ?? `https://github.com/${fullName}/commit/${sha}`,
        createdAt,
      });
    }
  }

  return results;
}

async function loadRecentPullRequestActivity(account: Account, since: Date, repoFilter?: RepoFilterInput) {
  const token = decrypt(account.accessToken);
  const octokit = createGithubClient(token);
  const username = account.username?.trim();
  if (!username) {
    return [] as GithubActivityItem[];
  }
  const repoFilters = normalizeRepoFilterInput(repoFilter);
  const queries = (repoFilters.length ? repoFilters : [null]).map((repo) => {
    const parts = [
      "is:pr",
      `author:${username}`,
      `updated:>=${since.toISOString().slice(0, 10)}`,
    ];
    if (repo) {
      parts.push(`repo:${repo}`);
    }
    return parts.join(" ");
  });
  const results: GithubActivityItem[] = [];

  for (const query of queries) {
    const search = await octokit.rest.search.issuesAndPullRequests({
      q: query,
      sort: "updated",
      order: "desc",
      per_page: 50,
    });

    for (const item of search.data.items) {
      const repo = parseRepoFromApiUrl(item.repository_url);
      const title = item.title?.trim();
      const pullNumber = item.number;
      const htmlUrl = item.html_url?.trim();

      if (!repo || !title || !pullNumber || !htmlUrl) {
        continue;
      }

      if (!matchesRepoFilter(repo, repoFilters)) {
        continue;
      }

      let mergedAt: string | null = null;
      let closedAt: string | null = item.closed_at ?? null;
      let updatedAt: string | null = item.updated_at ?? null;
      let state = item.state ?? null;
      let draft = false;
      let requestedReviewers: Array<unknown> = [];
      let requestedTeams: Array<unknown> = [];

      try {
        const [owner, repoName] = repo.split("/");
        const pull = await octokit.rest.pulls.get({
          owner,
          repo: repoName,
          pull_number: pullNumber,
        });
        mergedAt = pull.data.merged_at ?? null;
        closedAt = pull.data.closed_at ?? closedAt;
        updatedAt = pull.data.updated_at ?? updatedAt;
        state = pull.data.state ?? state;
        draft = Boolean(pull.data.draft);
        requestedReviewers = pull.data.requested_reviewers ?? [];
        requestedTeams = pull.data.requested_teams ?? [];
      } catch {
        // Fall back to the search result when the detailed pull request fetch fails.
      }

      const statusInfo = getPullRequestStatus({
        mergedAt,
        closedAt,
        updatedAt,
        state,
      });

      if (!statusInfo.createdAt || statusInfo.createdAt < since) {
        continue;
      }

      results.push({
        repo,
        title,
        content: buildPullRequestContent(repo, title, statusInfo.status),
        source: "github_pr",
        externalId: buildPullRequestExternalId(
          repo,
          pullNumber,
          statusInfo.status,
          statusInfo.createdAt.toISOString(),
        ),
        externalUrl: htmlUrl,
        metadata: buildPullRequestMetadata({
          pullNumber,
          mergedAt,
          state,
          draft,
          requestedReviewers,
          requestedTeams,
        }),
        createdAt: statusInfo.createdAt,
      });
    }
  }

  return results;
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
  repoFilter?: RepoFilterInput,
) {
  const username = account.username;
  if (!username) {
    return [] as GithubActivityItem[];
  }
  const repoFilters = normalizeRepoFilterInput(repoFilter);

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

    if (!matchesRepoFilter(repoName, repoFilters)) {
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

  const recentCommitActivity = await loadRecentCommitActivity(account, since, repoFilters);
  const recentPullRequestActivity = await loadRecentPullRequestActivity(account, since, repoFilters);
  const deduped = new Map<string, GithubActivityItem>();

  for (const item of [...results, ...recentCommitActivity, ...recentPullRequestActivity]) {
    const key = getActivityDedupeKey(item);
    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, item);
      continue;
    }

    if (getActivityPriority(item) > getActivityPriority(existing)) {
      deduped.set(key, item);
      continue;
    }

    if (
      getActivityPriority(item) === getActivityPriority(existing) &&
      item.createdAt.getTime() > existing.createdAt.getTime()
    ) {
      deduped.set(key, item);
    }
  }

  return [...deduped.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}
