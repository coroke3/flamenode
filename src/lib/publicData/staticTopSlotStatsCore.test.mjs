import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTopSlotStatsOverride,
  normalizeStaticTopSlotStats,
} from "./staticTopSlotStatsCore.ts";
import { normalizeStaticTop } from "./staticTopCore.ts";

test("normalizeStaticTopSlotStats: 有効 artifact を正規化する", () => {
  const artifact = normalizeStaticTopSlotStats({
    schema_version: 1,
    generated_at: 100,
    items: [
      { event_id: "event-1", available: 3, total: 5 },
      { event_id: "event-2", available: 1, total: 2 },
    ],
  });
  assert.ok(artifact);
  assert.equal(artifact.generatedAt, 100);
  assert.deepEqual(artifact.items.get("event-1"), { available: 3, total: 5 });
  assert.deepEqual(artifact.items.get("event-2"), { available: 1, total: 2 });
});

test("normalizeStaticTopSlotStats: schema mismatch / malformed は null", () => {
  assert.equal(normalizeStaticTopSlotStats(null), null);
  assert.equal(normalizeStaticTopSlotStats({ schema_version: 2, generated_at: 1, items: [] }), null);
  assert.equal(normalizeStaticTopSlotStats({ schema_version: 1, generated_at: 0, items: [] }), null);
  assert.equal(normalizeStaticTopSlotStats({ schema_version: 1, generated_at: 1 }), null);
});

test("applyTopSlotStatsOverride: artifact 有効時は topSlotStats を置換する", () => {
  const top = normalizeStaticTop({
    latest: [{ id: "v1", title: "Video", display_name: "Creator" }],
    slot_stats: [{ event_id: "event-1", available: 1, total: 10 }],
  });
  assert.ok(top);
  const artifact = normalizeStaticTopSlotStats({
    schema_version: 1,
    generated_at: 50,
    items: [{ event_id: "event-1", available: 9, total: 10 }],
  });
  const merged = applyTopSlotStatsOverride(top, artifact);
  assert.deepEqual(merged.topSlotStats.get("event-1"), { available: 9, total: 10 });
  assert.equal(merged.latest[0].id, "v1");
});

test("applyTopSlotStatsOverride: artifact 無効時は top.json.slot_stats を維持", () => {
  const top = normalizeStaticTop({
    latest: [{ id: "v1", title: "Video", display_name: "Creator" }],
    slot_stats: [{ event_id: "event-1", available: 1, total: 10 }],
  });
  assert.ok(top);
  const merged = applyTopSlotStatsOverride(top, null);
  assert.deepEqual(merged.topSlotStats.get("event-1"), { available: 1, total: 10 });
});
