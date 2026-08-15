import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const transition = fs.readFileSync(
  new URL("./xUserVisibilityTransition.ts", import.meta.url),
  "utf8",
);
const merge = fs.readFileSync(
  new URL("./merge.ts", import.meta.url),
  "utf8",
);
const rebuild = fs.readFileSync(
  new URL("../../../workers/json-generator/rebuild.ts", import.meta.url),
  "utf8",
);

test("x_user listability changes block stale profiles and release after both artifacts", () => {
  assert.match(transition, /entity_type: "x_user"/);
  assert.match(transition, /PUBLIC_LISTABLE_X_APPROVAL_STATUSES/);
  assert.match(transition, /preCommitXUserVisibilityTransition/);
  assert.match(transition, /compensateXUserVisibilityOnD1Failure/);
  assert.match(merge, /planXUserVisibilityFenceTransition/);
  assert.match(merge, /buildStaticRebuildQueueBatch/);
  assert.match(merge, /preCommitXUserVisibilityTransition/);
  assert.match(rebuild, /target_type = 'users_index'/);
  assert.match(rebuild, /releaseVisibilityFenceAfterRebuild\(\s*env,\s*"x_user"/s);
});

test("X ID merge/revert invalidates affected video and event projections", () => {
  assert.match(merge, /video_event_links/);
  assert.match(merge, /buildMergeStaticRebuildTargets/);
  assert.ok((merge.match(/buildMergeStaticRebuildTargets\(/g) ?? []).length >= 3);
  assert.match(merge, /targetType: "video"/);
  assert.match(merge, /targetType: "event_base"/);
  assert.match(merge, /targetType: "event_slots"/);
  assert.match(merge, /"random_video_pool"/);
  assert.match(merge, /targetType,\n\s+targetId: "global"/);
});
