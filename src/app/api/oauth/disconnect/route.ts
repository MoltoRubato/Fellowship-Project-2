import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import { db } from "@/server/db";
import { sendAuthChangeDm } from "@/server/services/slack";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const provider = request.nextUrl.searchParams.get("provider");
  if (provider !== "github" && provider !== "linear") {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }

  await db.account.deleteMany({
    where: {
      userId: session.user.id,
      provider,
    },
  });

  if (provider === "linear") {
    await db.projectIntegration.deleteMany({
      where: {
        type: "linear",
        project: { userId: session.user.id },
      },
    });
  }

  await sendAuthChangeDm(session.user.slackUserId, provider, false);
  return NextResponse.json({ success: true });
}
