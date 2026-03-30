import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { getGithubConnectionSnapshot } from "@/server/services/integrations/github";
import { getLinearConnectionSnapshot } from "@/server/services/integrations/linear";
import { getUserContextById, syncGithubProjects } from "@/server/services/standup";
import { TRPCError } from "@trpc/server";

export const dashboardRouter = createTRPCRouter({
  status: protectedProcedure.query(async ({ ctx }) => {
    const user = await getUserContextById(ctx.session.user.id);
    if (!user) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
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

    return {
      user: {
        slackUserId: user.slackUserId,
      },
      accounts: (refreshedUser?.accounts ?? []).map((account) => ({
        provider: account.provider,
        username: account.username,
        scope: account.scope,
      })),
      projects: (refreshedUser?.projects ?? []).map((project) => {
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
    };
  }),
});
