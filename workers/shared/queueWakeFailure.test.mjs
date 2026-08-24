import assert from "node:assert/strict";
import { test } from "node:test";

const {
  recordQueueWakeFailureBestEffort,
  resetQueueWakeFailureRecordStateForTests,
} = await import("./queueWakeFailure.ts");

test("worker wake failure telemetry coalesces concurrent duplicate writes", async () => {
  resetQueueWakeFailureRecordStateForTests();
  const puts = [];
  const kv = {
    async put(key, value, options) {
      puts.push({ key, value, options });
    },
  };

  await Promise.all([
    recordQueueWakeFailureBestEffort({
      kind: "notification_available",
      reason: "send_failed",
      kv,
    }),
    recordQueueWakeFailureBestEffort({
      kind: "notification_available",
      reason: "send_failed",
      kv,
    }),
  ]);

  assert.equal(puts.length, 1);
});
