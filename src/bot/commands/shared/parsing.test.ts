import test from "node:test";
import assert from "node:assert/strict";
import { parseSummaryArgs } from "./parsing";

test("parseSummaryArgs collects multiple repos and week period", () => {
  const parsed = parseSummaryArgs("week ReadMeIO/Gitto readmeio/readme");

  assert.equal(parsed.period, "week");
  assert.deepEqual(parsed.repos, ["readmeio/gitto", "readmeio/readme"]);
});

test("parseSummaryArgs ignores non-repo tokens and de-dupes repos", () => {
  const parsed = parseSummaryArgs("readmeio/readme, today readmeio/readme notes");

  assert.equal(parsed.period, "today");
  assert.deepEqual(parsed.repos, ["readmeio/readme"]);
});
