import { Prisma } from "@prisma/client";

export type UserContext = Prisma.UserGetPayload<{
  include: {
    accounts: true;
    projects: {
      include: { integrations: true };
      orderBy: [{ lastUsedAt: "desc" }, { githubRepoUpdatedAt: "desc" }, { updatedAt: "desc" }];
    };
  };
}>;

export const USER_CONTEXT_INCLUDE = {
  accounts: true,
  projects: {
    include: { integrations: true },
    orderBy: [
      { lastUsedAt: "desc" as const },
      { githubRepoUpdatedAt: "desc" as const },
      { updatedAt: "desc" as const },
    ],
  },
} as const satisfies Prisma.UserInclude;

export interface LoggedEntryInput {
  slackUserId: string;
  slackTeamId: string;
  repo?: string | null;
  content: string;
  entryType: import("@prisma/client").EntryType;
  source?: import("@prisma/client").EntrySource;
  title?: string | null;
  externalId?: string | null;
  externalUrl?: string | null;
  metadata?: Prisma.InputJsonValue;
  createdAt?: Date;
}
