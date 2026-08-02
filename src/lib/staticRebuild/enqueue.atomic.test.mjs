import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  shouldUseIncomingQueueMetadata,
  pickHigherPriority,
} from "./priorityCore.ts";

test("低優先度入力は高優先度 reason を上書きしない", () => {
  assert.equal(shouldUseIncomingQueueMetadata("high", "low"), false);
  assert.equal(shouldUseIncomingQueueMetadata("normal", "low"), false);
  assert.equal(shouldUseIncomingQueueMetadata("low", "high"), true);
  assert.equal(shouldUseIncomingQueueMetadata("normal", "high"), true);
});

test("pickHigherPriority は高い方を返す", () => {
  assert.equal(pickHigherPriority("high", "low"), "high");
  assert.equal(pickHigherPriority("low", "normal"), "normal");
});

test("atomic builder は latest done skip を持たない", async () => {
  const source = await readFile(new URL("./enqueue.ts", import.meta.url), "utf8");
  const batchFn = source.slice(
    source.indexOf("export async function buildStaticRebuildQueueBatch"),
    source.indexOf("async function shouldSkipRecentEnqueue"),
  );
  assert.doesNotMatch(batchFn, /shouldSkipRecentRow/);
  assert.doesNotMatch(batchFn, /latestRows/);
  assert.doesNotMatch(batchFn, /latest_static_rebuild_queue/);
  assert.match(source, /STATIC_REBUILD_BATCH_PREFETCH_QUERY_COUNT = 1/);
  assert.match(batchFn, /shouldUseIncomingQueueMetadata/);
});

test("direct enqueue は public_miss / periodic / manual_repair のみ", async () => {
  const source = await readFile(
    new URL("./directEnqueue.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /DirectEnqueueResult/);
  assert.match(source, /cooldown_skipped/);
  assert.match(source, /direct_enqueue_cause_mismatch/);
  assert.doesNotMatch(source, /console\.warn\("\[enqueueStaticRebuild\] failed"/);
});
