import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import { linkIntegration } from "@/server/services/standup";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    projectId?: string;
    type?: string;
    externalId?: string | null;
    externalTeamId?: string | null;
    externalName?: string | null;
  };

  if (!body.projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }

  if (body.type !== "linear") {
    return NextResponse.json({ error: "Unsupported integration type" }, { status: 400 });
  }

  try {
    const result = await linkIntegration(session.user.id, {
      projectId: body.projectId,
      type: body.type,
      externalId: body.externalId ?? null,
      externalTeamId: body.externalTeamId ?? null,
      externalName: body.externalName ?? null,
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to link integration" },
      { status: 400 },
    );
  }
}
