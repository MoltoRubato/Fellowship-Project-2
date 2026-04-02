import test from "node:test";
import assert from "node:assert/strict";
import { withSoftTimeout } from "./async";

test("withSoftTimeout returns the resolved value before the timeout", async () => {
  const result = await withSoftTimeout(Promise.resolve("ok"), 20);

  assert.deepEqual(result, {
    timedOut: false,
    value: "ok",
  });
});

test("withSoftTimeout returns timedOut when the promise exceeds the deadline", async () => {
  const result = await withSoftTimeout(
    new Promise<string>((resolve) => {
      setTimeout(() => resolve("late"), 20);
    }),
    1,
  );

  assert.deepEqual(result, {
    timedOut: true,
    value: null,
  });
});
