import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { sendAuthChangeDm } from "@/server/services/slack";
import { linkIntegration } from "@/server/services/standup";

export const userRouter = createTRPCRouter({
  me: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      include: {
        accounts: {
          orderBy: { provider: "asc" },
        },
        projects: {
          include: { integrations: true },
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
        await ctx.db.projectIntegration.deleteMany({
          where: {
            type: "linear",
            project: { userId: ctx.session.user.id },
          },
        });
      }

      await sendAuthChangeDm(ctx.session.user.slackUserId, input.provider, false);
      return { success: true };
    }),

  linkIntegration: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        type: z.enum(["linear"]),
        externalId: z.string().nullish(),
        externalTeamId: z.string().nullish(),
        externalName: z.string().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await linkIntegration(ctx.session.user.id, input);
      return { success: true };
    }),
});
