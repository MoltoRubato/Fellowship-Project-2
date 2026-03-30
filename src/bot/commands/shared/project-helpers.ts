import type { UserContext } from "@/server/services/standup";

function getProjectTimestamp(value?: Date | null) {
  return value instanceof Date ? value.getTime() : 0;
}

export function sortProjectsForRepoPicker(projects: UserContext["projects"]) {
  return [...projects].sort((left, right) => {
    const usedDelta = getProjectTimestamp(right.lastUsedAt) - getProjectTimestamp(left.lastUsedAt);
    if (usedDelta !== 0) {
      return usedDelta;
    }

    const updatedDelta =
      getProjectTimestamp(right.githubRepoUpdatedAt) - getProjectTimestamp(left.githubRepoUpdatedAt);
    if (updatedDelta !== 0) {
      return updatedDelta;
    }

    return left.githubRepo.localeCompare(right.githubRepo);
  });
}

export function getMostRecentlyUpdatedRepo(user?: UserContext | null) {
  if (!user?.projects.length) {
    return null;
  }

  const [project] = sortProjectsForRepoPicker(user.projects);

  return project?.githubRepo ?? null;
}

export function sortRepoNamesForRepoPicker(repoNames: string[], user?: UserContext | null) {
  const orderedProjects = sortProjectsForRepoPicker(
    (user?.projects ?? []).filter((project) => repoNames.includes(project.githubRepo)),
  );
  const orderedRepoNames = orderedProjects.map((project) => project.githubRepo);
  const remainingRepoNames = repoNames
    .filter((repo) => !orderedRepoNames.includes(repo))
    .sort((left, right) => left.localeCompare(right));

  return [...orderedRepoNames, ...remainingRepoNames];
}
