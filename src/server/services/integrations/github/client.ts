import { Octokit } from "@octokit/rest";
import { db } from "@/server/db";

export function createGithubClient(accessToken: string) {
  return new Octokit({ auth: accessToken });
}

export function parseScopeHeader(raw?: string | null) {
  return (raw ?? "")
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export function buildPermissionWarning(scopes: string[]) {
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

export async function getGithubAccount(userId: string) {
  return db.account.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: "github",
      },
    },
  });
}
