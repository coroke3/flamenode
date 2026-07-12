import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_QUEUE_ATTEMPTS,
  MAX_QUEUE_BATCH,
  boundedQueueBatch,
  withBoundedRetry,
} from "./queue.ts";

test("queue limits are always bounded and positive", () => {
  assert.equal(boundedQueueBatch(999), MAX_QUEUE_BATCH);
  assert.equal(boundedQueueBatch(0), 1);
  assert.equal(boundedQueueBatch(Number.NaN), MAX_QUEUE_BATCH);
});

test("withBoundedRetry stops at the hard attempt cap", async () => {
  let calls = 0;
  await assert.rejects(
    withBoundedRetry(
      async () => {
        calls += 1;
        throw new Error("transient");
      },
      { attempts: 999 },
    ),
    /transient/,
  );
  assert.equal(calls, MAX_QUEUE_ATTEMPTS);
});

test("withBoundedRetry returns after a transient failure", async () => {
  let calls = 0;
  const value = await withBoundedRetry(async () => {
    calls += 1;
    if (calls === 1) throw new Error("try again");
    return "ok";
  }, { attempts: 2 });
  assert.equal(value, "ok");
  assert.equal(calls, 2);
});
