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
    generated_at: 40,
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

test("applyTopSlotStatsOverride: artifact.generated_at < top.generated_at でも artifact を採用", () => {
  const top = normalizeStaticTop({
    generated_at: 100,
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
});

test("applyTopSlotStatsOverride: artifact が新しいときは artifact を採用", () => {
  const top = normalizeStaticTop({
    generated_at: 50,
    latest: [{ id: "v1", title: "Video", display_name: "Creator" }],
    slot_stats: [{ event_id: "event-1", available: 1, total: 10 }],
  });
  assert.ok(top);
  const artifact = normalizeStaticTopSlotStats({
    schema_version: 1,
    generated_at: 100,
    items: [{ event_id: "event-1", available: 9, total: 10 }],
  });
  const merged = applyTopSlotStatsOverride(top, artifact);
  assert.deepEqual(merged.topSlotStats.get("event-1"), { available: 9, total: 10 });
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

test("top slot stats wire schema is not coercible from strings, booleans or arrays", () => {
  const valid = { schema_version: 1, generated_at: 100, items: [] };
  assert.ok(normalizeStaticTopSlotStats(valid, 100));
  for (const schema_version of ["1", true, [1], null, 0, 2]) {
    assert.equal(
      normalizeStaticTopSlotStats({ ...valid, schema_version }, 100),
      null,
      `invalid schema_version ${JSON.stringify(schema_version)}`,
    );
  }
  assert.equal(normalizeStaticTopSlotStats([valid], 100), null);
});

test("top slot stats requires canonical positive integer generated_at", () => {
  const valid = { schema_version: 1, generated_at: 100, items: [] };
  for (const generated_at of [
    "100", "1e2", true, [100], null, false, 0, -1, 1.5,
    Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.equal(
      normalizeStaticTopSlotStats({ ...valid, generated_at }, 1000),
      null,
      `invalid generated_at ${String(generated_at)}`,
    );
  }
  assert.equal(normalizeStaticTopSlotStats(valid, 1000)?.generatedAt, 100);
});

test("top slot stats rejects implausible future generations without dropping small clock skew", () => {
  const nowSec = 10_000;
  const base = {
    schema_version: 1,
    generated_at: nowSec + 300,
    items: [{ event_id: "event-1", available: 2, total: 5 }],
  };
  assert.equal(normalizeStaticTopSlotStats(base, nowSec)?.generatedAt, 10_300);
  assert.equal(normalizeStaticTopSlotStats({ ...base, generated_at: 10_301 }, nowSec), null);
  assert.equal(normalizeStaticTopSlotStats({ ...base, generated_at: 999_999_999 }, nowSec), null);
  assert.equal(normalizeStaticTopSlotStats(base, Number.NaN), null);
  assert.equal(normalizeStaticTopSlotStats(base, -1), null);
});

test("invalid top slot stats must not override valid embedded homepage availability", () => {
  const top = normalizeStaticTop({
    latest: [{ id: "v1", title: "Video" }],
    slot_stats: [{ event_id: "event-1", available: 4, total: 8 }],
  });
  assert.ok(top);
  const malformed = normalizeStaticTopSlotStats({
    schema_version: "1",
    generated_at: "200",
    items: [{ event_id: "event-1", available: 0, total: 8 }],
  }, 200);
  assert.equal(malformed, null);
  assert.deepEqual(applyTopSlotStatsOverride(top, malformed).topSlotStats.get("event-1"), {
    available: 4,
    total: 8,
  });
});
