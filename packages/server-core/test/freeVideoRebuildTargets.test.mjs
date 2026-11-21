import test from "node:test";
import assert from "node:assert/strict";
import { buildFreeVideoRebuildTargets } from "@flamenode/server-core/video/freeVideoRebuildTargets";
import { topVideoVisibilityTargets } from "@flamenode/server-core/staticRebuild/hooks";

const videoId = "v-1";
const userId = "u-1";
const activeXId = "x-1";
const reason = "video_create";

function expectedCoreTargets() {
  return [
    { targetType: "video", targetId: videoId, reason, priority: "high", requestedByUserId: userId },
    { targetType: "list_recent", targetId: "global", reason },
    { targetType: "list_popular", targetId: "global", reason },
    { targetType: "search_index", targetId: "global", reason },
    { targetType: "users_index", targetId: "global", reason },
    { targetType: "member_suggestions", targetId: "global", reason },
    ...topVideoVisibilityTargets(reason),
    { targetType: "random_video_pool", targetId: "global", reason, priority: "normal", requestedByUserId: userId },
    { targetType: "user", targetId: activeXId, reason },
  ];
}
const args = { videoId, userId, activeXId };

test("MIG-0651 U02: no linked event preserves the exact 13 CURRENT queue targets and their order", () => {
  const targets = buildFreeVideoRebuildTargets({ ...args, eventId: null });
  assert.deepEqual(targets, expectedCoreTargets());
  assert.equal(targets.length, 13);
  assert.ok(targets.every((item) => item.reason === reason));
  assert.equal(targets.filter((item) => item.targetType.startsWith("event_")).length, 0);
});
test("MIG-0651 U02: linked event appends the three high-priority event targets, unchanged", () => {
  const eventId = "event-1";
  const targets = buildFreeVideoRebuildTargets({ ...args, eventId });
  assert.deepEqual(targets, [
    ...expectedCoreTargets(),
    { targetType: "event_base", targetId: eventId, reason, priority: "high" },
    { targetType: "event_slots", targetId: eventId, reason, priority: "high" },
    { targetType: "event_release", targetId: eventId, reason, priority: "high" },
  ]);
  assert.equal(targets.length, 16);
  assert.equal(new Set(targets.map(({ targetType, targetId }) => targetType + ":" + targetId)).size, 16);
});
test("MIG-0651 U02: building targets twice does not share mutable request state", () => {
  const a = buildFreeVideoRebuildTargets({ ...args, eventId: null });
  const b = buildFreeVideoRebuildTargets({ ...args, eventId: null });
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a[0], b[0]);
  a[0].priority = "low";
  assert.equal(b[0].priority, "high");
});
