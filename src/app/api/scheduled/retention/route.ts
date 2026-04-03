import { NextRequest, NextResponse } from "next/server";
import { runScheduledJob } from "@/server/services/jobs";
import { runRetentionCleanup } from "@/server/services/retention";
import { isAuthorizedScheduledRequest, parseOptionalExecutionDate } from "@/server/services/scheduled-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isAuthorizedScheduledRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const at = parseOptionalExecutionDate(request.nextUrl.searchParams.get("at"));
  if (!at) {
    return NextResponse.json({ error: "Invalid at timestamp" }, { status: 400 });
  }

  const result = await runScheduledJob({
    jobKey: "retention-cleanup",
    leaseMs: 15 * 60 * 1000,
    task: async () => runRetentionCleanup(at),
  });

  return NextResponse.json(result, {
    status: result.acquired ? 200 : 202,
  });
}
