import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import { linkLinearProject } from "@/server/services/standup";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    projectId?: string;
    linearProjectId?: string | null;
    linearTeamId?: string | null;
    linearProjectName?: string | null;
  };

  if (!body.projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }

  try {
    const project = await linkLinearProject(session.user.id, {
      projectId: body.projectId,
      linearProjectId: body.linearProjectId ?? null,
      linearTeamId: body.linearTeamId ?? null,
      linearProjectName: body.linearProjectName ?? null,
    });

    return NextResponse.json({ success: true, project });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to link Linear project" },
      { status: 400 },
    );
  }
}
