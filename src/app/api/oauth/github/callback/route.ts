import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import { exchangeGithubCode, saveGithubAccount } from "@/server/services/github";
import { sendAuthChangeDm } from "@/server/services/slack";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (!session?.user?.id || !code || !state || state !== session.user.id) {
    return NextResponse.redirect(new URL("/auth?error=github_state", request.url));
  }

  try {
    const redirectUri = new URL("/api/oauth/github/callback", request.nextUrl.origin).toString();
    const account = await exchangeGithubCode(code, redirectUri);
    await saveGithubAccount(session.user.id, account);
    await sendAuthChangeDm(session.user.slackUserId, "github", true);

    return NextResponse.redirect(new URL("/auth?connected=github", request.url));
  } catch (error) {
    console.error("GitHub OAuth error", error);
    return NextResponse.redirect(new URL("/auth?error=github_oauth", request.url));
  }
}
