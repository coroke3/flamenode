import assert from "node:assert/strict";
import { test } from "node:test";
import {
  combineJobCounters,
  normalizeJobCounters,
  runJob,
  throwIfJobFailed,
} from "./runJob.ts";

test("normalizeJobCounters preserves finite counters and clamps invalid values", () => {
  assert.deepEqual(normalizeJobCounters(3), {
    processed: 3,
    skipped: 0,
    failed: 0,
  });
  assert.deepEqual(
    normalizeJobCounters({
      processed: Number.NaN,
      skipped: Number.POSITIVE_INFINITY,
      failed: -2,
      applied: true,
    }),
    { processed: 1, skipped: 0, failed: 0 },
  );
});

test("combineJobCounters aggregates normalized child results", () => {
  assert.deepEqual(
    combineJobCounters(
      { processed: 2, skipped: 1, failed: 0 },
      { processed: 3, skipped: 0, failed: 1 },
      null,
    ),
    { processed: 5, skipped: 1, failed: 1 },
  );
});

test("runJob keeps reported counters when a child summary is promoted to failure", async () => {
  const result = await runJob("worker", "cron", async () =>
    throwIfJobFailed("worker", "cron", {
      processed: 4,
      skipped: 2,
      failed: 1,
    }),
  );
  assert.deepEqual(result, {
    succeeded: false,
    processed: 4,
    skipped: 2,
    failed: 1,
  });
});

test("throwIfJobFailed preserves the existing rethrow message", async () => {
  await assert.rejects(
    runJob(
      "worker",
      "cron",
      async () =>
        throwIfJobFailed("worker", "cron", {
          processed: 1,
          failed: 2,
        }),
      { rethrow: true },
    ),
    /worker\/cron reported 2 failed operation\(s\)/,
  );
});
