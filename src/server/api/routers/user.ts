import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { linkLinearProject, setDefaultProject } from "@/server/services/standup";

export const userRouter = createTRPCRouter({
  me: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      include: {
        accounts: {
          orderBy: { provider: "asc" },
        },
        defaultProject: true,
        projects: {
          orderBy: [{ lastUsedAt: "desc" }, { githubRepo: "asc" }],
        },
      },
    });
  }),

  connectedAccounts: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.account.findMany({
      where: { userId: ctx.session.user.id },
      select: {
        provider: true,
        username: true,
        scope: true,
      },
      orderBy: { provider: "asc" },
    });
  }),

  disconnectAccount: protectedProcedure
    .input(z.object({ provider: z.enum(["github", "linear"]) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.account.deleteMany({
        where: {
          userId: ctx.session.user.id,
          provider: input.provider,
        },
      });

      if (input.provider === "linear") {
        await ctx.db.project.updateMany({
          where: { userId: ctx.session.user.id },
          data: {
            linearProjectId: null,
            linearTeamId: null,
            linearProjectName: null,
          },
        });
      }

      return { success: true };
    }),

  setDefaultProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await setDefaultProject(ctx.session.user.id, input.projectId);
      return { success: true };
    }),

  linkLinearProject: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        linearProjectId: z.string().nullish(),
        linearTeamId: z.string().nullish(),
        linearProjectName: z.string().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await linkLinearProject(ctx.session.user.id, input);
      return { success: true };
    }),
});
