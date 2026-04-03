import { NextRequest, NextResponse } from "next/server";
import {
  handleLinearWebhook,
  isFreshLinearWebhook,
  verifyLinearWebhookSignature,
} from "@/server/services/integrations/linear";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("linear-signature");

  if (!verifyLinearWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid Linear signature" }, { status: 401 });
  }

  try {
    const payload = JSON.parse(rawBody) as {
      webhookTimestamp?: number | null;
    } & Record<string, unknown>;

    if (!isFreshLinearWebhook(payload.webhookTimestamp ?? null)) {
      return NextResponse.json({ error: "Stale Linear webhook" }, { status: 401 });
    }

    const result = await handleLinearWebhook(payload);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Linear webhook failed", error);
    return NextResponse.json({ error: "Linear webhook failed" }, { status: 500 });
  }
}
