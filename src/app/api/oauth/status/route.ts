import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import { getGithubConnectionSnapshot } from "@/server/services/integrations/github";
import { getLinearConnectionSnapshot } from "@/server/services/integrations/linear";
import { getUserContextById, syncGithubProjects } from "@/server/services/standup";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ accounts: [] }, { status: 401 });
  }

  const user = await getUserContextById(session.user.id);
  if (!user) {
    return NextResponse.json({ accounts: [] }, { status: 404 });
  }

  const github = await getGithubConnectionSnapshot(user.id);
  if (github.connected) {
    await syncGithubProjects(
      user.id,
      github.repos.map((repo) => ({
        id: repo.id,
        nameWithOwner: repo.nameWithOwner,
        url: repo.url,
        updatedAt: repo.updatedAt,
      })),
    );
  }

  const refreshedUser = await getUserContextById(user.id);
  const linear = await getLinearConnectionSnapshot(user.id);

  return NextResponse.json({
    user: {
      slackUserId: user.slackUserId,
    },
    accounts: refreshedUser?.accounts.map((account) => ({
      provider: account.provider,
      username: account.username,
      scope: account.scope,
    })),
    projects: refreshedUser?.projects.map((project) => {
      const linearIntegration = project.integrations.find((i) => i.type === "linear");
      return {
        id: project.id,
        githubRepo: project.githubRepo,
        githubRepoUrl: project.githubRepoUrl,
        linearProjectId: linearIntegration?.externalId ?? null,
        linearTeamId: linearIntegration?.externalTeamId ?? null,
        linearProjectName: linearIntegration?.externalName ?? null,
        lastUsedAt: project.lastUsedAt,
      };
    }),
    github,
    linear,
  });
}
