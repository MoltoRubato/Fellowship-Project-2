import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import { exchangeLinearCode, saveLinearAccount } from "@/server/services/linear";
import { sendAuthChangeDm } from "@/server/services/slack";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (!session?.user?.id || !code || !state || state !== session.user.id) {
    return NextResponse.redirect(new URL("/auth?error=linear_state", request.url));
  }

  try {
    const baseUrl = process.env.APP_URL ?? request.nextUrl.origin;
    const redirectUri = new URL("/api/oauth/linear/callback", baseUrl).toString();
    const account = await exchangeLinearCode(code, redirectUri);
    await saveLinearAccount(session.user.id, account);
    await sendAuthChangeDm(session.user.slackUserId, "linear", true);

    return NextResponse.redirect(new URL("/auth?connected=linear", request.url));
  } catch (error) {
    console.error("Linear OAuth error", error);
    return NextResponse.redirect(new URL("/auth?error=linear_oauth", request.url));
  }
}
