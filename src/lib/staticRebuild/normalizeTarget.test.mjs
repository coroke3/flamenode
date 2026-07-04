import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeStaticRebuildTarget } from "./normalizeTarget.ts";

test("event_groups_index は events_index:global へ正規化", () => {
  const out = normalizeStaticRebuildTarget({
    targetType: "event_groups_index",
    targetId: "global",
    reason: "manual",
  });
  assert.equal(out.targetType, "events_index");
  assert.equal(out.targetId, "global");
  assert.match(out.reason, /alias:event_groups_index/);
});

test("event_group は events_index:global へ正規化", () => {
  const out = normalizeStaticRebuildTarget({
    targetType: "event_group",
    targetId: "my-slug",
    reason: "manual",
  });
  assert.equal(out.targetType, "events_index");
  assert.equal(out.targetId, "global");
});

test("既知の target はそのまま", () => {
  const input = {
    targetType: "event",
    targetId: "ev1",
    reason: "public_event_detail_miss",
  };
  assert.deepEqual(normalizeStaticRebuildTarget(input), input);
});
