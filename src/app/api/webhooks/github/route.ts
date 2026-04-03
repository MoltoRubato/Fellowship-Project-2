import { NextRequest, NextResponse } from "next/server";
import {
  handleGithubWebhook,
  verifyGithubWebhookSignature,
} from "@/server/services/integrations/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyGithubWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid GitHub signature" }, { status: 401 });
  }

  const eventName = request.headers.get("x-github-event");
  if (!eventName) {
    return NextResponse.json({ error: "Missing GitHub event header" }, { status: 400 });
  }

  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const result = await handleGithubWebhook(eventName, payload);
    return NextResponse.json(result);
  } catch (error) {
    console.error("GitHub webhook failed", error);
    return NextResponse.json({ error: "GitHub webhook failed" }, { status: 500 });
  }
}
