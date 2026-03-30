import { encrypt } from "@/lib/crypto";
import { db } from "@/server/db";
import { fetchLinear } from "./client";

export async function exchangeLinearCode(code: string, redirectUri: string) {
  const tokenRes = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: process.env.LINEAR_CLIENT_ID ?? "",
      client_secret: process.env.LINEAR_CLIENT_SECRET ?? "",
    }),
  });

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    scope?: string;
    error?: string;
  };

  if (!tokenData.access_token) {
    throw new Error(tokenData.error ?? "Linear token exchange failed");
  }

  const data = await fetchLinear<{
    viewer: {
      id: string;
      name: string;
      email: string;
    };
  }>(
    tokenData.access_token,
    `
      query LinearViewer {
        viewer {
          id
          name
          email
        }
      }
    `,
  );

  return {
    providerAccountId: data.viewer.id,
    username: data.viewer.name || data.viewer.email,
    encryptedToken: encrypt(tokenData.access_token),
    scope: tokenData.scope ?? "read",
  };
}

export async function saveLinearAccount(
  userId: string,
  account: {
    providerAccountId: string;
    username: string;
    encryptedToken: string;
    scope: string;
  },
) {
  return db.account.upsert({
    where: {
      userId_provider: {
        userId,
        provider: "linear",
      },
    },
    create: {
      userId,
      provider: "linear",
      providerAccountId: account.providerAccountId,
      accessToken: account.encryptedToken,
      username: account.username,
      scope: account.scope,
    },
    update: {
      providerAccountId: account.providerAccountId,
      accessToken: account.encryptedToken,
      username: account.username,
      scope: account.scope,
    },
  });
}
