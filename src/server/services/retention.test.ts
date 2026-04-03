import test from "node:test";
import assert from "node:assert/strict";
import { getRetentionCutoffs } from "./retention";

test("getRetentionCutoffs respects configured day windows", () => {
  const previousExternal = process.env.RETENTION_EXTERNAL_LOG_DAYS;
  const previousManual = process.env.RETENTION_MANUAL_LOG_DAYS;

  process.env.RETENTION_EXTERNAL_LOG_DAYS = "10";
  process.env.RETENTION_MANUAL_LOG_DAYS = "90";

  try {
    const cutoffs = getRetentionCutoffs(new Date("2026-04-03T12:00:00.000Z"));

    assert.equal(cutoffs.policy.externalLogEntriesDays, 10);
    assert.equal(cutoffs.policy.manualLogEntriesDays, 90);
    assert.equal(cutoffs.externalLogEntriesBefore.toISOString(), "2026-03-24T12:00:00.000Z");
    assert.equal(cutoffs.manualLogEntriesBefore.toISOString(), "2026-01-03T12:00:00.000Z");
  } finally {
    process.env.RETENTION_EXTERNAL_LOG_DAYS = previousExternal;
    process.env.RETENTION_MANUAL_LOG_DAYS = previousManual;
  }
});
