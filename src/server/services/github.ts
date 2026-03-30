import { type Account } from "@prisma/client";
import { Octokit } from "@octokit/rest";
import { decrypt, encrypt } from "@/lib/crypto";
import { db } from "@/server/db";

export interface GithubVisibleRepo {
  id: string;
  nameWithOwner: string;
  url: string;
  isPrivate: boolean;
  visibility: string;
  updatedAt: string | null;
}

export interface GithubConnectionSnapshot {
  connected: boolean;
  username: string | null;
  scopes: string[];
  permissionWarning: string | null;
  repos: GithubVisibleRepo[];
}

export interface GithubActivityItem {
  repo: string;
  title: string;
  content: string;
  source: "github_commit" | "github_pr";
  externalId: string;
  externalUrl?: string;
  createdAt: Date;
}

export interface GithubCommitLookup {
  repo: string;
  sha: string;
  message: string;
  createdAt: Date;
}

export interface GithubCommitDetail {
  repo: string;
  sha: string;
  message: string;
  authors: string[];
  createdAt: Date;
  files: Array<{
    filename: string;
    status?: string;
    patch?: string | null;
  }>;
}

function createGithubClient(accessToken: string) {
  return new Octokit({ auth: accessToken });
}

function parseScopeHeader(raw?: string | null) {
  return (raw ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function buildPermissionWarning(scopes: string[]) {
  const hasRepoAccess = scopes.includes("repo") || scopes.includes("public_repo");
  const hasUserAccess = scopes.includes("read:user");

  if (!hasRepoAccess) {
    return "Repository access looks incomplete. Connect GitHub with repo visibility so the bot can list repos and import commit activity.";
  }

  if (!hasUserAccess) {
    return "The connection is missing read:user, so username lookups may fail.";
  }

  if (scopes.includes("repo")) {
    return "GitHub OAuth exposes private repository access via the broad repo scope. The app only performs read operations with that token.";
  }

  return null;
}

async function getGithubAccount(userId: string) {
  return db.account.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: "github",
      },
    },
  });
}

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

export async function exchangeGithubCode(code: string, redirectUri: string) {
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
    scope?: string;
  };

  if (!tokenData.access_token) {
    throw new Error(tokenData.error ?? "GitHub token exchange failed");
  }

  const octokit = createGithubClient(tokenData.access_token);
  const viewer = await octokit.request("GET /user");
  const scopes = parseScopeHeader(String(viewer.headers["x-oauth-scopes"] ?? tokenData.scope ?? ""));

  return {
    providerAccountId: String(viewer.data.id),
    username: viewer.data.login,
    encryptedToken: encrypt(tokenData.access_token),
    scopes,
  };
}

export async function saveGithubAccount(
  userId: string,
  account: {
    providerAccountId: string;
    username: string;
    encryptedToken: string;
    scopes: string[];
  },
) {
  return db.account.upsert({
    where: {
      userId_provider: {
        userId,
        provider: "github",
      },
    },
    create: {
      userId,
      provider: "github",
      providerAccountId: account.providerAccountId,
      accessToken: account.encryptedToken,
      username: account.username,
      scope: account.scopes.join(","),
    },
    update: {
      providerAccountId: account.providerAccountId,
      accessToken: account.encryptedToken,
      username: account.username,
      scope: account.scopes.join(","),
    },
  });
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
