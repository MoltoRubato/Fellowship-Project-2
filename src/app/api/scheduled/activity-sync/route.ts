import { NextRequest, NextResponse } from "next/server";
import { runScheduledJob } from "@/server/services/jobs";
import { isAuthorizedScheduledRequest, parseOptionalExecutionDate } from "@/server/services/scheduled-http";
import { runActivitySyncSweep } from "@/server/services/standup/activity-sweep";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isAuthorizedScheduledRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const since = parseOptionalExecutionDate(request.nextUrl.searchParams.get("since"), null);
  if (request.nextUrl.searchParams.has("since") && !since) {
    return NextResponse.json({ error: "Invalid since timestamp" }, { status: 400 });
  }

  const result = await runScheduledJob({
    jobKey: "activity-sync-sweep",
    leaseMs: 30 * 60 * 1000,
    task: async () => runActivitySyncSweep(since ? { since } : undefined),
  });

  return NextResponse.json(result, {
    status: result.acquired ? 200 : 202,
  });
}
