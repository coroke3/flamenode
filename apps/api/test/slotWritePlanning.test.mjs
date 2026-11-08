import assert from "node:assert/strict";
import test from "node:test";
import { parseJstDatetimeLocalStrict } from "@flamenode/domain/datetime";
import { planGeneratedSlots } from "../src/routes/manage/slotWritePlanning.ts";

test("MIG-0656 U02a: time mode preserves CURRENT complete-interval timestamps and orders", () => {
  const first = parseJstDatetimeLocalStrict("2026-11-08T10:00:30");
  assert.equal(first.ok, true);
  assert.notEqual(first.value, null);
  const plan = planGeneratedSlots({
    mode: "time", start_at: "2026-11-08T10:00:30",
    end_at: "2026-11-08T10:12:30", interval_minutes: 5,
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.candidates, [
    { start_time: first.value, sort_order: 0, slot_label: null },
    { start_time: first.value + 300, sort_order: 1, slot_label: null },
  ]);
  const epoch = planGeneratedSlots({
    mode: "time", start_at: "1970-01-01T09:00",
    end_at: "1970-01-01T09:05", interval_minutes: 5,
  });
  assert.deepEqual(epoch, { ok: true, candidates: [
    { start_time: 0, sort_order: 0, slot_label: null },
  ] });
});

test("MIG-0656 U02a: no partial row, bad JST calendar or reversed range", () => {
  const base = { mode: "time", start_at: "2026-11-08T10:00",
    end_at: "2026-11-08T10:30", interval_minutes: 5 };
  for (const delta of [
    { start_at: "2026-02-30T10:00" },
    { start_at: "2026-11-08T24:00" },
    { start_at: "2026-11-08T10:00Z" },
    { start_at: "" },
    { end_at: null },
    { end_at: "2026-11-08T09:59" },
  ]) assert.equal(planGeneratedSlots({ ...base, ...delta }).ok, false, JSON.stringify(delta));
  assert.deepEqual(planGeneratedSlots({ ...base, end_at: "2026-11-08T10:04" }),
    { ok: false, message: "作成対象の枠がありません。" });
});

test("MIG-0656 U02a: exactly 100 candidates allowed; 101 and malformed extras rejected", () => {
  const base = { mode: "time", start_at: "2026-11-08T10:00",
    end_at: "2026-11-08T11:40", interval_minutes: 1 };
  const hundred = planGeneratedSlots(base);
  assert.equal(hundred.ok, true);
  assert.equal(hundred.candidates.length, 100);
  assert.deepEqual(planGeneratedSlots({ ...base, end_at: "2026-11-08T11:41" }),
    { ok: false, message: "一度に作成できる枠は 100 件までです。" });
  assert.equal(planGeneratedSlots({ ...base, count: 101 }).ok, false);
  assert.equal(planGeneratedSlots({ ...base, count: "1" }).ok, false);
  assert.equal(planGeneratedSlots({ mode: "count", count: 1, interval_minutes: 0 }).ok, false);
});

test("MIG-0656 U02a: count defaults, prefix trim, start-index zero and upper bound", () => {
  assert.deepEqual(planGeneratedSlots({ mode: "count" }), { ok: true, candidates: [
    { start_time: null, sort_order: 1, slot_label: "No.1" },
  ] });
  assert.deepEqual(planGeneratedSlots({ mode: "count", count: 2, start_index: 0,
    label_prefix: "   " }), { ok: true, candidates: [
    { start_time: null, sort_order: 1, slot_label: "No.1" },
    { start_time: null, sort_order: 2, slot_label: "No.2" },
  ] });
  assert.deepEqual(planGeneratedSlots({ mode: "count", count: 2,
    start_index: 9999, label_prefix: " 第 " }), { ok: true, candidates: [
    { start_time: null, sort_order: 9999, slot_label: "第 9999" },
    { start_time: null, sort_order: 10000, slot_label: "第 10000" },
  ] });
  const max = planGeneratedSlots({ mode: "count", count: 100 });
  assert.equal(max.ok, true);
  assert.equal(max.candidates.length, 100);
  for (const count of [0, 101, "3", null]) {
    assert.equal(planGeneratedSlots({ mode: "count", count }).ok, false);
  }
});
