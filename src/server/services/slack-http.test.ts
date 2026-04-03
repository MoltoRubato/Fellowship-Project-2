import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import { verifySlackRequestSignature } from "./slack-http";

test("verifySlackRequestSignature accepts a valid Slack signature", () => {
  const originalSecret = process.env.SLACK_SIGNING_SECRET;
  process.env.SLACK_SIGNING_SECRET = "slack-secret";

  try {
    const body = "command=%2Fsummarise&text=today";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac("sha256", "slack-secret")
      .update(`v0:${timestamp}:${body}`)
      .digest("hex")}`;

    assert.equal(
      verifySlackRequestSignature({
        rawBody: body,
        timestamp,
        signature,
      }),
      true,
    );
    assert.equal(
      verifySlackRequestSignature({
        rawBody: body,
        timestamp,
        signature: "v0=invalid",
      }),
      false,
    );
  } finally {
    process.env.SLACK_SIGNING_SECRET = originalSecret;
  }
});
