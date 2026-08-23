import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_QUEUE_ATTEMPTS,
  MAX_QUEUE_BATCH,
  boundedQueueBatch,
  isRetryableQueueError,
  nextAttemptNumber,
  withBoundedRetry,
} from "./queue.ts";

test("queue limits are always bounded and positive", () => {
  assert.equal(boundedQueueBatch(999), MAX_QUEUE_BATCH);
  assert.equal(boundedQueueBatch(0), 1);
  assert.equal(boundedQueueBatch(Number.NaN), MAX_QUEUE_BATCH);
  assert.equal(
    boundedQueueBatch(undefined, Number.NaN),
    MAX_QUEUE_BATCH,
  );
});

test("nextAttemptNumber normalizes malformed DB values", () => {
  assert.equal(nextAttemptNumber(0), 1);
  assert.equal(nextAttemptNumber(2.9), 3);
  assert.equal(nextAttemptNumber("3"), 4);
  assert.equal(nextAttemptNumber(Number.NaN), 1);
  assert.equal(nextAttemptNumber(-4), 1);
});

test("withBoundedRetry stops at the hard attempt cap", async () => {
  let calls = 0;
  await assert.rejects(
    withBoundedRetry(
      async () => {
        calls += 1;
        throw new Error("transient connection error");
      },
      { attempts: 999 },
    ),
    /transient/,
  );
  assert.equal(calls, MAX_QUEUE_ATTEMPTS);
});

test("withBoundedRetry returns after a transient failure", async () => {
  let calls = 0;
  const value = await withBoundedRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error("try again");
      return "ok";
    },
    { attempts: 2 },
  );
  assert.equal(value, "ok");
  assert.equal(calls, 2);
});

test("deterministic schema failures are not retried", async () => {
  let calls = 0;
  await assert.rejects(
    withBoundedRetry(
      async () => {
        calls += 1;
        throw new Error("no such table: audit_logs");
      },
      { attempts: 3 },
    ),
    /no such table/,
  );
  assert.equal(calls, 1);
});

test("HTTP 429 and 5xx are retryable but 4xx validation errors are not", () => {
  assert.equal(isRetryableQueueError({ status: 429 }), true);
  assert.equal(isRetryableQueueError({ statusCode: 503 }), true);
  assert.equal(
    isRetryableQueueError({ status: 400, message: "invalid payload" }),
    false,
  );
});

test("Cloudflare D1のretry推奨transient errorをqueueでも再試行する", () => {
  for (const message of [
    "Network connection lost.",
    "Replica disconnected from primary.",
    "Cannot resolve D1 DB due to transient issue on remote node.",
    "Internal error in D1 DB storage caused object to be reset.",
    "reset because its code was updated",
  ]) {
    assert.equal(isRetryableQueueError(new Error(message)), true, message);
  }
});

test("D1 overload/CPU/memory limitは同一invocation内でblind retryしない", () => {
  for (const message of [
    "D1 DB is overloaded. Requests queued for too long.",
    "D1 DB is overloaded. Too many requests queued.",
    "D1 DB's isolate exceeded its memory limit and was reset.",
    "D1 DB exceeded its CPU time limit and was reset.",
    "D1 DB storage operation exceeded timeout which caused object to be reset.",
  ]) {
    assert.equal(isRetryableQueueError({ status: 503, message }), false, message);
  }
});

test("a custom retry classifier can override the default", async () => {
  let calls = 0;
  const value = await withBoundedRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error("domain-specific-retry");
      return "ok";
    },
    {
      attempts: 2,
      shouldRetry: (error) =>
        String(error).includes("domain-specific-retry"),
    },
  );
  assert.equal(value, "ok");
  assert.equal(calls, 2);
});
