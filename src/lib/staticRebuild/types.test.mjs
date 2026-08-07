import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isStaticRebuildTargetType,
  STATIC_REBUILD_TARGET_TYPES,
} from "./types.ts";

test("static rebuild targetはcanonical種だけを受理する", () => {
  assert.deepEqual(STATIC_REBUILD_TARGET_TYPES, [
    "top",
    "top_slot_stats",
    "events_index",
    "event",
    "video",
    "user",
    "users_index",
    "list_recent",
    "list_popular",
    "search_index",
    "recommend_core",
    "recommend",
    "rules",
    "youtube_related_blocklist",
    "random_video_pool",
  ]);
  for (const target of STATIC_REBUILD_TARGET_TYPES) {
    assert.equal(isStaticRebuildTargetType(target), true);
  }
  for (const alias of [
    "video_detail",
    "event_detail",
    "user_profile",
    "groups_index",
    "event_groups_index",
    "event_group",
  ]) {
    assert.equal(isStaticRebuildTargetType(alias), false, alias);
  }
});

test("enqueueとWorkerは旧target aliasを正規化・no-op完了しない", () => {
  const enqueue = readFileSync(new URL("./enqueue.ts", import.meta.url), "utf8");
  const workerQueue = readFileSync(
    new URL("../../../workers/json-generator/queue.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(enqueue, /normalizeStaticRebuildTarget|alias:/);
  assert.doesNotMatch(workerQueue, /DEPRECATED_TARGET_TYPES/);
});
