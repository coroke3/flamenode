import assert from "node:assert/strict";
import test from "node:test";
import { planSlotGenerate, planSlotClearAvailable, planSlotListAction } from
  "../.test-dist/apps/ops/src/api/slotWriteIntent.js";

test("MIG-0722 U03a: all 9 MIG-0656 action names and JSON bodies have explicit plans", () => {
  const eventId = "ev1";
  const list = [
    { kind: "delete", slotId: "slot1" },
    { kind: "release", slotId: "slot1" },
    { kind: "force-release-submitted", slotId: "slot1" },
    { kind: "release-submitted-video", slotId: "slot1" },
    { kind: "batch-delete", slotIds: [" a ", "b", "a"] },
    { kind: "batch-release", slotIds: ["a", "b"] },
    { kind: "batch-label", slotIds: [" a ", "b"], label: "  第1回  " },
  ].map(op => planSlotListAction(eventId, op));
  assert.deepEqual(list.map(plan => plan?.action), [
    "deleteSlot", "releaseSlot", "forceReleaseSubmittedSlot",
    "releaseSubmittedVideoKeepReservation", "batchDeleteAvailableSlots",
    "batchReleaseReservedSlots", "batchUpdateSlotLabels",
  ]);
  assert.deepEqual(list.slice(0, 4).map(plan => plan?.body), [{}, {}, {}, {}]);
  assert.deepEqual(list[4]?.body, { slot_ids: ["a", "b"] });
  assert.deepEqual(list[5]?.body, { slot_ids: ["a", "b"] });
  assert.deepEqual(list[6]?.body, { slot_ids: ["a", "b"], label: "第1回" });
  const clear = planSlotClearAvailable(eventId);
  assert.deepEqual(clear, { action: "deleteAvailableSlots", eventId, body: {} });
  assert.deepEqual(planSlotGenerate(eventId, {
    mode: "count", count: 100, start_index: 0, label_prefix: " No. ",
  }), { action: "generateSlotsBatch", eventId, body: {
    mode: "count", count: 100, start_index: 0, label_prefix: "No.",
  } });
});

test("MIG-0722 U03a: invalid event/slot IDs and corrupt batches fail closed", () => {
  for (const invalid of ["", ".", "..", " a", "a ", "a/b", "a\\b", "a\0b",
                          "\uD800", "\uDC00"]) {
    assert.equal(planSlotClearAvailable(invalid), null, JSON.stringify(invalid));
    assert.equal(planSlotListAction(invalid, { kind: "delete", slotId: "a" }),
      null, JSON.stringify(invalid));
    assert.equal(planSlotListAction("good", { kind: "release", slotId: invalid }),
      null, JSON.stringify(invalid));
  }
  for (const slotIds of [[], [" "], ["a", "b", "c", "d"],
      ["a", null], [1], "a"]) {
    assert.equal(planSlotListAction("ev1", { kind: "batch-delete", slotIds }),
      null, JSON.stringify(slotIds));
  }
  assert.deepEqual(planSlotListAction("ev1", {
    kind: "batch-delete", slotIds: ["a", " a ", "b", "c"],
  })?.body, { slot_ids: ["a", "b", "c"] }, "deduplicate before 3-row limit");
  for (const op of [
    { kind: "mystery", slotId: "a" }, { kind: "mystery", slotIds: ["a"] },
    { kind: "batch-label", slotIds: ["a"], label: "" },
    { kind: "batch-label", slotIds: ["a"], label: " ".repeat(3) },
    { kind: "batch-label", slotIds: ["a"], label: "x".repeat(201) },
    { kind: "batch-label", slotIds: ["a"], label: 123 },
  ]) assert.equal(planSlotListAction("ev1", op), null, JSON.stringify(op));
});

test("MIG-0722 U03a: generation is bounded and rejects numeric coercion and invalid JST", () => {
  const eventId = "ev1";
  const time = {
    mode: "time", start_at: "2026-11-08T10:00", end_at: "2026-11-08T10:30",
    interval_minutes: 5,
  };
  assert.deepEqual(planSlotGenerate(eventId, time), {
    action: "generateSlotsBatch", eventId, body: time,
  });
  const allowed = { ...time, end_at: "2026-11-08T11:40", interval_minutes: 1 };
  assert.ok(planSlotGenerate(eventId, allowed), "exact 100 1-minute slots");
  for (const bad of [
    { end_at: "2026-11-09T10:00" }, { end_at: "2026-11-08T10:00" },
    { end_at: "2026-11-08T10:04" }, { start_at: "2026-02-30T10:00" },
    { start_at: "2026-11-08T24:00" }, { end_at: "2026-11-08T10:30Z" },
    { interval_minutes: "5" }, { interval_minutes: 1.5 },
    { interval_minutes: 0 }, { interval_minutes: 1441 },
  ]) assert.equal(planSlotGenerate(eventId, { ...time, ...bad }), null,
    JSON.stringify(bad));
  const count = { mode: "count", count: 5, start_index: 1, label_prefix: "No." };
  for (const bad of [
    { count: 0 }, { count: 101 }, { count: "5" }, { count: 1.2 },
    { start_index: -1 }, { start_index: 10000 },
    { label_prefix: "x".repeat(41) }, { label_prefix: null },
  ]) assert.equal(planSlotGenerate(eventId, { ...count, ...bad }), null,
    JSON.stringify(bad));
  assert.equal(planSlotGenerate(eventId, { mode: "unknown" }), null);
});
