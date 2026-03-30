import { encrypt } from "@/lib/crypto";
import { db } from "@/server/db";
import { createGithubClient, parseScopeHeader } from "./client";

export async function exchangeGithubCode(code: string, redirectUri: string) {
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
    scope?: string;
  };

  if (!tokenData.access_token) {
    throw new Error(tokenData.error ?? "GitHub token exchange failed");
  }

  const octokit = createGithubClient(tokenData.access_token);
  const viewer = await octokit.request("GET /user");
  const scopes = parseScopeHeader(String(viewer.headers["x-oauth-scopes"] ?? tokenData.scope ?? ""));

  return {
    providerAccountId: String(viewer.data.id),
    username: viewer.data.login,
    encryptedToken: encrypt(tokenData.access_token),
    scopes,
  };
}

export async function saveGithubAccount(
  userId: string,
  account: {
    providerAccountId: string;
    username: string;
    encryptedToken: string;
    scopes: string[];
  },
) {
  return db.account.upsert({
    where: {
      userId_provider: {
        userId,
        provider: "github",
      },
    },
    create: {
      userId,
      provider: "github",
      providerAccountId: account.providerAccountId,
      accessToken: account.encryptedToken,
      username: account.username,
      scope: account.scopes.join(","),
    },
    update: {
      providerAccountId: account.providerAccountId,
      accessToken: account.encryptedToken,
      username: account.username,
      scope: account.scopes.join(","),
    },
  });
}
