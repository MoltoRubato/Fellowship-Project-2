import { type DefaultSession, type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "@/server/db";

const nextAuthSecret =
  process.env.NEXTAUTH_SECRET ??
  process.env.ENCRYPTION_KEY ??
  "standup-bot-dev-secret";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: DefaultSession["user"] & {
      id: string;
      slackUserId: string;
    };
  }

  interface User {
    slackUserId: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    slackUserId: string;
  }
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  providers: [
    CredentialsProvider({
      name: "Slack Link",
      credentials: {
        token: { label: "Link Token", type: "text" },
      },
      async authorize(credentials) {
        const token = credentials?.token?.trim();
        if (!token) {
          return null;
        }

        const linkToken = await db.linkToken.findFirst({
          where: {
            token,
            used: false,
            expiresAt: { gt: new Date() },
          },
        });

        if (!linkToken) {
          return null;
        }

        await db.linkToken.update({
          where: { id: linkToken.id },
          data: {
            used: true,
            usedAt: new Date(),
          },
        });

        const user = await db.user.upsert({
          where: { slackUserId: linkToken.slackUserId },
          create: {
            slackUserId: linkToken.slackUserId,
            slackTeamId: linkToken.slackTeamId,
          },
          update: {
            slackTeamId: linkToken.slackTeamId,
          },
        });

        return {
          id: user.id,
          name: user.slackUserId,
          slackUserId: user.slackUserId,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.slackUserId = user.slackUserId;
      }

      return token;
    },
    session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: token.userId,
          slackUserId: token.slackUserId,
        },
      };
    },
  },
  pages: {
    signIn: "/auth",
  },
  secret: nextAuthSecret,
};
