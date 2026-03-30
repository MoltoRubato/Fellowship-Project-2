import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";

export async function GET(request: NextRequest) {
  const baseUrl = process.env.APP_URL ?? request.nextUrl.origin;
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/auth", baseUrl));
  }

  const redirectUri = new URL("/api/oauth/linear/callback", baseUrl).toString();
  const params = new URLSearchParams({
    client_id: process.env.LINEAR_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    scope: "read",
    response_type: "code",
    actor: "user",
    state: session.user.id,
  });

  return NextResponse.redirect(`https://linear.app/oauth/authorize?${params.toString()}`);
}
