import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { getGithubConnectionSnapshot } from "@/server/services/integrations/github";
import { getLinearConnectionSnapshot } from "@/server/services/integrations/linear";
import { getSlackUserProfile } from "@/server/services/slack";
import { getUserContextById, getUserContextBySlackId, ensureSlackUser, syncGithubProjects } from "@/server/services/standup";
import { TRPCError } from "@trpc/server";

export const dashboardRouter = createTRPCRouter({
  status: protectedProcedure.query(async ({ ctx }) => {
    let user = await getUserContextById(ctx.session.user.id)
      ?? await getUserContextBySlackId(ctx.session.user.slackUserId);
    if (!user) {
      const { user: created } = await ensureSlackUser(ctx.session.user.slackUserId, "");
      user = await getUserContextById(created.id);
    }
    if (!user) {
      throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
    }

    const [github, slackProfile] = await Promise.all([
      getGithubConnectionSnapshot(user.id),
      getSlackUserProfile(user.slackUserId),
    ]);

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

    return {
      user: {
        slackUserId: user.slackUserId,
        slackDisplayName: slackProfile?.displayName ?? null,
        slackAvatarUrl: slackProfile?.avatarUrl ?? null,
      },
      accounts: (refreshedUser?.accounts ?? []).map((account) => ({
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
        githubRepoUpdatedAt: project.githubRepoUpdatedAt,
        lastUsedAt: project.lastUsedAt,
      })),
      github,
      linear,
    };
  }),
});
