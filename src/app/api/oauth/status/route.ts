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
  const visibleProjects = github.connected ? refreshedUser?.projects ?? [] : [];

  return NextResponse.json({
    user: {
      slackUserId: user.slackUserId,
    },
    accounts: refreshedUser?.accounts.map((account) => ({
      provider: account.provider,
      username: account.username,
      scope: account.scope,
    })),
    projects: visibleProjects.map((project) => ({
      id: project.id,
      githubRepo: project.githubRepo,
      githubRepoUrl: project.githubRepoUrl,
      linearProjectId: project.linearProjectId,
      linearTeamId: project.linearTeamId,
      linearProjectName: project.linearProjectName,
      lastUsedAt: project.lastUsedAt,
    })),
    github,
    linear,
  });
}
