import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import { decrypt } from "@/lib/crypto";
import { getGithubAccount } from "@/server/services/integrations/github/client";

const SCOPES = "read:user repo";

export async function GET(request: NextRequest) {
  const baseUrl = process.env.APP_URL ?? request.nextUrl.origin;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/auth", baseUrl));
  }

  const reauth = request.nextUrl.searchParams.get("reauth") === "1";

  if (reauth) {
    const account = await getGithubAccount(session.user.id);
    if (account?.accessToken) {
      const token = decrypt(account.accessToken);
      const clientId = process.env.GITHUB_CLIENT_ID ?? "";
      const clientSecret = process.env.GITHUB_CLIENT_SECRET ?? "";
      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

      // Revoke the token first, then the entire grant so GitHub
      // forgets this user ever authorized the app and shows the
      // full consent screen (including org access) on next auth.
      for (const endpoint of ["token", "grant"] as const) {
        try {
          const res = await fetch(
            `https://api.github.com/applications/${clientId}/${endpoint}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Basic ${basicAuth}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ access_token: token }),
            },
          );
          console.log(`GitHub revoke ${endpoint}: ${res.status}`);
        } catch (err) {
          console.error(`GitHub revoke ${endpoint} failed:`, err);
        }
      }
    }
  }

  const redirectUri = new URL("/api/oauth/github/callback", baseUrl).toString();
  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    scope: SCOPES,
    state: session.user.id,
  });

  return NextResponse.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
}
