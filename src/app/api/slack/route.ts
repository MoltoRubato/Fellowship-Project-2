import { after, NextRequest, NextResponse } from "next/server";
import {
  buildSlackAckResponse,
  parseSlackFormBody,
  startSlackCommandExecution,
  startSlackInteractionExecution,
  verifySlackRequestSignature,
} from "@/server/services/slack-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const verified = verifySlackRequestSignature({
    rawBody,
    timestamp: request.headers.get("x-slack-request-timestamp"),
    signature: request.headers.get("x-slack-signature"),
  });

  if (!verified) {
    return NextResponse.json({ error: "Invalid Slack signature" }, { status: 401 });
  }

  const params = parseSlackFormBody(rawBody);
  const payloadParam = params.get("payload");
  const hasCommand = params.has("command");

  try {
    if (payloadParam) {
      const payload = JSON.parse(payloadParam) as Record<string, unknown>;
      const execution = startSlackInteractionExecution(payload);

      after(async () => {
        await execution.handlerPromise;
      });

      const ackResult = await execution.ackPromise;
      const body = buildSlackAckResponse(ackResult);

      return body === null
        ? new NextResponse(null, { status: 200 })
        : NextResponse.json(body);
    }

    if (hasCommand) {
      const command = Object.fromEntries(params.entries());
      const execution = startSlackCommandExecution(command);

      after(async () => {
        await execution.handlerPromise;
      });

      const ackResult = await execution.ackPromise;
      const body = buildSlackAckResponse(ackResult);

      return body === null
        ? new NextResponse(null, { status: 200 })
        : NextResponse.json(body);
    }
  } catch (error) {
    console.error("Slack HTTP handler failed", error);
    return NextResponse.json({ error: "Slack request failed" }, { status: 500 });
  }

  return NextResponse.json({ error: "Unsupported Slack payload" }, { status: 400 });
}
