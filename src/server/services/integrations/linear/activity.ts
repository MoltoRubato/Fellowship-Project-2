import { type Account } from "@prisma/client";
import { decrypt } from "@/lib/crypto";
import type { LinearProjectOption, LinearConnectionSnapshot, LinearActivityItem } from "./types";
import { fetchLinear, getLinearAccount } from "./client";

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

  const reposByProjectId = new Map<string, string[]>();
  for (const mapping of projectMappings) {
    const repos = reposByProjectId.get(mapping.linearProjectId) ?? [];
    if (!repos.includes(mapping.githubRepo)) {
      repos.push(mapping.githubRepo);
      reposByProjectId.set(mapping.linearProjectId, repos);
    }
  }

  const results: LinearActivityItem[] = [];

  for (const issue of data.viewer.assignedIssues.nodes) {
    const linearProjectId = issue.project?.id ?? "";
    const repos = reposByProjectId.get(linearProjectId);
    if (!repos?.length) {
      continue;
    }

    const createdAt = new Date(issue.updatedAt);
    const state = issue.state?.name ?? "Updated";
    for (const repo of repos) {
      if (repoFilter && repo.toLowerCase() !== repoFilter.toLowerCase()) {
        continue;
      }

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
  }

  return results.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}
