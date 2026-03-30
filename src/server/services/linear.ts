import { type Account } from "@prisma/client";
import { decrypt, encrypt } from "@/lib/crypto";
import { db } from "@/server/db";

export interface LinearProjectOption {
  id: string;
  name: string;
  teamId: string;
  teamKey: string;
  teamName: string;
}

export interface LinearConnectionSnapshot {
  connected: boolean;
  username: string | null;
  permissionWarning: string | null;
  projects: LinearProjectOption[];
}

export interface LinearActivityItem {
  repo: string;
  title: string;
  content: string;
  source: "linear_issue";
  externalId: string;
  externalUrl?: string;
  createdAt: Date;
}

interface LinearGraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function fetchLinear<T>(accessToken: string, query: string, variables?: Record<string, unknown>) {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = (await response.json()) as LinearGraphQLResponse<T>;

  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join(", "));
  }

  if (!json.data) {
    throw new Error("Linear returned an empty response");
  }

  return json.data;
}

async function getLinearAccount(userId: string) {
  return db.account.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: "linear",
      },
    },
  });
}

export async function exchangeLinearCode(code: string, redirectUri: string) {
  const tokenRes = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: process.env.LINEAR_CLIENT_ID ?? "",
      client_secret: process.env.LINEAR_CLIENT_SECRET ?? "",
    }),
  });

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    scope?: string;
    error?: string;
  };

  if (!tokenData.access_token) {
    throw new Error(tokenData.error ?? "Linear token exchange failed");
  }

  const data = await fetchLinear<{
    viewer: {
      id: string;
      name: string;
      email: string;
    };
  }>(
    tokenData.access_token,
    `
      query LinearViewer {
        viewer {
          id
          name
          email
        }
      }
    `,
  );

  return {
    providerAccountId: data.viewer.id,
    username: data.viewer.name || data.viewer.email,
    encryptedToken: encrypt(tokenData.access_token),
    scope: tokenData.scope ?? "read",
  };
}

export async function saveLinearAccount(
  userId: string,
  account: {
    providerAccountId: string;
    username: string;
    encryptedToken: string;
    scope: string;
  },
) {
  return db.account.upsert({
    where: {
      userId_provider: {
        userId,
        provider: "linear",
      },
    },
    create: {
      userId,
      provider: "linear",
      providerAccountId: account.providerAccountId,
      accessToken: account.encryptedToken,
      username: account.username,
      scope: account.scope,
    },
    update: {
      providerAccountId: account.providerAccountId,
      accessToken: account.encryptedToken,
      username: account.username,
      scope: account.scope,
    },
  });
}

async function loadLinearProjects(account: Account) {
  const accessToken = decrypt(account.accessToken);
  const data = await fetchLinear<{
    teams: {
      nodes: Array<{
        id: string;
        key: string;
        name: string;
        projects: {
          nodes: Array<{
            id: string;
            name: string;
          }>;
        };
      }>;
    };
  }>(
    accessToken,
    `
      query LinearTeamsAndProjects {
        teams {
          nodes {
            id
            key
            name
            projects {
              nodes {
                id
                name
              }
            }
          }
        }
      }
    `,
  );

  const projects: LinearProjectOption[] = [];

  for (const team of data.teams.nodes) {
    for (const project of team.projects.nodes) {
      projects.push({
        id: project.id,
        name: project.name,
        teamId: team.id,
        teamKey: team.key,
        teamName: team.name,
      });
    }
  }

  return projects.sort((a, b) =>
    `${a.teamName}/${a.name}`.localeCompare(`${b.teamName}/${b.name}`),
  );
}

export async function getLinearConnectionSnapshot(userId: string): Promise<LinearConnectionSnapshot> {
  const account = await getLinearAccount(userId);
  if (!account) {
    return {
      connected: false,
      username: null,
      permissionWarning: null,
      projects: [],
    };
  }

  const projects = await loadLinearProjects(account);
  const permissionWarning =
    projects.length === 0
      ? "The Linear account is connected, but no visible projects were returned for the viewer."
      : null;

  return {
    connected: true,
    username: account.username,
    permissionWarning,
    projects,
  };
}

export async function fetchLinearActivity(
  account: Account,
  since: Date,
  projectMappings: Array<{
    githubRepo: string;
    linearProjectId: string;
  }>,
  repoFilter?: string | null,
) {
  if (projectMappings.length === 0) {
    return [] as LinearActivityItem[];
  }

  const accessToken = decrypt(account.accessToken);
  const data = await fetchLinear<{
    viewer: {
      assignedIssues: {
        nodes: Array<{
          id: string;
          identifier: string;
          title: string;
          url: string;
          updatedAt: string;
          state?: { name: string | null } | null;
          project?: { id: string | null; name: string | null } | null;
        }>;
      };
    };
  }>(
    accessToken,
    `
      query LinearAssignedIssues($updatedAt: DateTimeOrDuration!) {
        viewer {
          assignedIssues(filter: { updatedAt: { gte: $updatedAt } }, first: 100) {
            nodes {
              id
              identifier
              title
              url
              updatedAt
              state {
                name
              }
              project {
                id
                name
              }
            }
          }
        }
      }
    `,
    {
      updatedAt: since.toISOString(),
    },
  );

  const mappingByProjectId = new Map(projectMappings.map((mapping) => [mapping.linearProjectId, mapping.githubRepo]));
  const results: LinearActivityItem[] = [];

  for (const issue of data.viewer.assignedIssues.nodes) {
    const linearProjectId = issue.project?.id ?? "";
    const repo = mappingByProjectId.get(linearProjectId);
    if (!repo) {
      continue;
    }

    if (repoFilter && repo.toLowerCase() !== repoFilter.toLowerCase()) {
      continue;
    }

    const createdAt = new Date(issue.updatedAt);
    const state = issue.state?.name ?? "Updated";
    results.push({
      repo,
      title: `${issue.identifier} ${issue.title}`,
      content: `${issue.identifier} moved to ${state}`,
      source: "linear_issue",
      externalId: `linear-issue:${issue.id}:${issue.updatedAt}`,
      externalUrl: issue.url,
      createdAt,
    });
  }

  return results.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}
