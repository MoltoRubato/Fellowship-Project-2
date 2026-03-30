import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { dashboardRouter } from "@/server/api/routers/dashboard";
import { userRouter } from "@/server/api/routers/user";

export const appRouter = createTRPCRouter({
  dashboard: dashboardRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
