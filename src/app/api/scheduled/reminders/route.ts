import { NextRequest, NextResponse } from "next/server";
import { sendDueReminders } from "@/bot/reminders/scheduler";
import { runScheduledJob } from "@/server/services/jobs";
import { isAuthorizedScheduledRequest, parseOptionalExecutionDate } from "@/server/services/scheduled-http";
import { getSlackWebClient } from "@/server/services/slack-client";

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
    jobKey: "reminder-dispatch",
    leaseMs: 10 * 60 * 1000,
    task: async () => sendDueReminders(getSlackWebClient(), at),
  });

  return NextResponse.json(result, {
    status: result.acquired ? 200 : 202,
  });
}
