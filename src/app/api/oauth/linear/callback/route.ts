import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import { exchangeLinearCode, saveLinearAccount } from "@/server/services/integrations/linear";
import { sendAuthChangeDm } from "@/server/services/slack";
import { db } from "@/server/db";

export async function GET(request: NextRequest) {
  const baseUrl = process.env.APP_URL ?? request.nextUrl.origin;
  const session = await getServerSession(authOptions);
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (!session?.user?.id || !code || !state || state !== session.user.id) {
    return NextResponse.redirect(new URL("/auth?error=linear_state", baseUrl));
  }

  const user = await db.user.findUnique({ where: { id: session.user.id } })
    ?? await db.user.upsert({
      where: { slackUserId: session.user.slackUserId },
      create: { slackUserId: session.user.slackUserId, slackTeamId: "" },
      update: {},
    });

  try {
    const redirectUri = new URL("/api/oauth/linear/callback", baseUrl).toString();
    const account = await exchangeLinearCode(code, redirectUri);
    await saveLinearAccount(user.id, account);
    await sendAuthChangeDm(session.user.slackUserId, "linear", true);

    return NextResponse.redirect(new URL("/auth?connected=linear", baseUrl));
  } catch (error) {
    console.error("Linear OAuth error", error);
    return NextResponse.redirect(new URL("/auth?error=linear_oauth", baseUrl));
  }
}
