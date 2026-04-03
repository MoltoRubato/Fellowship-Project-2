import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import { isFreshLinearWebhook, verifyLinearWebhookSignature } from "./webhooks";

test("verifyLinearWebhookSignature accepts a valid HMAC signature", () => {
  const originalSecret = process.env.LINEAR_WEBHOOK_SECRET;
  process.env.LINEAR_WEBHOOK_SECRET = "linear-secret";

  try {
    const rawBody = JSON.stringify({
      action: "update",
      type: "Issue",
      webhookTimestamp: 1_700_000_000_000,
    });
    const signature = createHmac("sha256", "linear-secret").update(rawBody).digest("hex");

    assert.equal(verifyLinearWebhookSignature(rawBody, signature), true);
    assert.equal(verifyLinearWebhookSignature(rawBody, "bad-signature"), false);
  } finally {
    process.env.LINEAR_WEBHOOK_SECRET = originalSecret;
  }
});

test("isFreshLinearWebhook enforces the replay window", () => {
  const now = 1_700_000_060_000;

  assert.equal(isFreshLinearWebhook(now - 30_000, now), true);
  assert.equal(isFreshLinearWebhook(now - 120_000, now), false);
  assert.equal(isFreshLinearWebhook(null, now), false);
});
