import assert from "node:assert/strict";
import { test } from "node:test";
import {
  combineJobCounters,
  jobFailureWithCounters,
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

test("normalizes and combines optional observability metrics without inventing unknown values", () => {
  assert.deepEqual(normalizeJobCounters({
    processed: 1,
    external_api_calls: 2,
    d1_changes: 3,
    retry_count: 1,
    quota_stopped: true,
    quota_stop_reason: "DAILY_LIMIT",
  }), {
    processed: 1, skipped: 0, failed: 0,
    external_api_calls: 2, d1_changes: 3, retry_count: 1,
    quota_stopped: true, quota_stop_reason: "daily_limit",
  });
  assert.deepEqual(combineJobCounters({ processed: 1 }, { d1_changes: 2, quota_stopped: true }), {
    processed: 1, skipped: 0, failed: 0, d1_changes: 2, quota_stopped: true,
  });
});

test("runJob carries metrics through a promoted child failure", async () => {
  const result = await runJob("worker", "cron", async () =>
    throwIfJobFailed("worker", "cron", {
      processed: 2, failed: 1, external_api_calls: 4, quota_stopped: true,
      quota_stop_reason: "rate_limit",
    }),
  );
  assert.equal(result.external_api_calls, 4);
  assert.equal(result.quota_stopped, true);
  assert.equal(result.quota_stop_reason, "rate_limit");
});

test("runJob carries measured work through a thrown runtime failure", async () => {
  const result = await runJob("worker", "runtime-failure", async () => {
    throw jobFailureWithCounters(new Error("upstream unavailable"), {
      failed: 1,
      external_api_calls: 3,
      d1_changes: 2,
      retry_count: 1,
    });
  });

  assert.deepEqual(result, {
    succeeded: false,
    processed: 0,
    skipped: 0,
    failed: 1,
    external_api_calls: 3,
    d1_changes: 2,
    retry_count: 1,
  });
});

test("runJob logs normalized metrics and only a valid lowercase commit SHA", async () => {
  const original = console.log;
  const lines = [];
  console.log = (value) => lines.push(String(value));
  try {
    await runJob(
      "worker",
      "observability",
      async () => ({ processed: 1, external_api_calls: 2 }),
      { commitSha: "ABCDEF1234567890ABCDEF1234567890ABCDEF12" },
    );
    await runJob(
      "worker",
      "invalid-commit",
      async () => ({ skipped: 1 }),
      { commitSha: "not-a-commit" },
    );
  } finally {
    console.log = original;
  }
  const valid = JSON.parse(lines[0]);
  assert.equal(valid.commit_sha, "abcdef1234567890abcdef1234567890abcdef12");
  assert.equal(valid.external_api_calls, 2);
  assert.equal(valid.d1_changes, 0);
  assert.equal(valid.retry_count, 0);
  assert.equal(valid.quota_stopped, false);
  assert.equal("commit_sha" in JSON.parse(lines[1]), false);
});
