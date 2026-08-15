import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  shouldUseIncomingQueueMetadata,
  pickHigherPriority,
  resolveQueueReason,
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

test("video visibility fence reason is never hidden by queue metadata merging", () => {
  assert.equal(
    resolveQueueReason("video_visibility_update", "event_id_rename", "high", "high"),
    "video_visibility_update",
  );
  assert.equal(
    resolveQueueReason("event_id_rename", "video_visibility_update", "high", "low"),
    "video_visibility_update",
  );
  assert.equal(
    resolveQueueReason("event_id_rename", "event_id_rename_old_cleanup", "high", "normal"),
    "event_id_rename_old_cleanup",
  );
  assert.equal(
    resolveQueueReason("event_id_rename_old_cleanup", "event_id_rename", "high", "high"),
    "event_id_rename_old_cleanup",
  );
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
  assert.match(source, /STATIC_REBUILD_BATCH_PREFETCH_QUERY_COUNT = 0/);
  assert.match(batchFn, /ON CONFLICT\(target_type, target_id\) WHERE status IN \('pending', 'processing'\)/);
  assert.match(batchFn, /event_id_rename_old_cleanup/);
  assert.match(batchFn, /FROM json_each\(\$\{payload\}\)/);
  assert.doesNotMatch(batchFn, /shouldUseIncomingQueueMetadata/);
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
