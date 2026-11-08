import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SlotGenerateBodySchema,
  SlotBatchIdsBodySchema,
  SlotBatchLabelsBodySchema,
  SlotNoBodySchema,
  SlotAdminWriteBodySchemas,
} from "../../../packages/contracts/src/slotAdminWrite.ts";

test("MIG-0656 U01: every CURRENT SA-056..064 has an explicit JSON body boundary", () => {
  assert.deepEqual(Object.keys(SlotAdminWriteBodySchemas).sort(), [
    "generateSlotsBatch",
    "deleteAvailableSlots",
    "releaseSlot",
    "deleteSlot",
    "batchDeleteAvailableSlots",
    "batchReleaseReservedSlots",
    "batchUpdateSlotLabels",
    "forceReleaseSubmittedSlot",
    "releaseSubmittedVideoKeepReservation",
  ].sort());
});

test("MIG-0656 U01: batch generator preserves CURRENT numeric defaults and limits", () => {
  assert.deepEqual(SlotGenerateBodySchema.parse({ mode: "count" }), {
    mode: "count", count: 1, start_index: 1,
  });
  assert.equal(SlotGenerateBodySchema.parse({ mode: "count", count: 100, start_index: 0 }).count, 100);
  assert.equal(SlotGenerateBodySchema.parse({ mode: "time", start_at: null, end_at: null }).interval_minutes, 5);
  for (const count of [0, 101, -1, 1.5, "2", true, null]) {
    assert.equal(SlotGenerateBodySchema.safeParse({ mode: "count", count }).success, false, String(count));
  }
  for (const input of [
    { mode: "count", start_index: 10000 },
    { mode: "count", label_prefix: "x".repeat(41) },
    { mode: "time", interval_minutes: 0 },
    { mode: "time", interval_minutes: 1441 },
    { mode: "time", interval_minutes: "5" },
    { mode: "other" },
  ]) {
    assert.equal(SlotGenerateBodySchema.safeParse(input).success, false, JSON.stringify(input));
  }
  assert.equal(SlotGenerateBodySchema.safeParse({
    mode: "count", label_prefix: " ".repeat(4) + "A".repeat(40),
  }).success, true);
});

test("MIG-0656 U01: batch IDs trim and dedupe before CURRENT 3-row atomic maximum", () => {
  assert.deepEqual(SlotBatchIdsBodySchema.parse({ slot_ids: [" a ", "b", "a", "c"] }),
    { slot_ids: ["a", "b", "c"] });
  for (const ids of [[], [" "], ["a", "b", "c", "d"], [1], ["a", null]]) {
    assert.equal(SlotBatchIdsBodySchema.safeParse({ slot_ids: ids }).success, false, JSON.stringify(ids));
  }
  assert.equal(SlotBatchIdsBodySchema.safeParse({ slot_ids: "[\"a\"]" }).success, false);
});

test("MIG-0656 U01: label update requires trimmed nonempty label, maximum 200", () => {
  assert.deepEqual(SlotBatchLabelsBodySchema.parse({
    slot_ids: ["a", " a "], label: "  Release  ",
  }), { slot_ids: ["a"], label: "Release" });
  for (const label of ["", "   ", "a".repeat(201), null]) {
    assert.equal(SlotBatchLabelsBodySchema.safeParse({ slot_ids: ["a"], label }).success, false);
  }
  assert.equal(SlotBatchLabelsBodySchema.safeParse({ slot_ids: ["a"], label: "x".repeat(200) }).success, true);
});

test("MIG-0656 U01: URL-only writes do not invent a dangerous confirmation field", () => {
  assert.deepEqual(SlotNoBodySchema.parse({}), {});
  assert.equal(SlotNoBodySchema.safeParse({ slot_id: "other" }).success, false);
  for (const action of [
    "deleteAvailableSlots", "releaseSlot", "deleteSlot",
    "forceReleaseSubmittedSlot", "releaseSubmittedVideoKeepReservation",
  ]) assert.equal(SlotAdminWriteBodySchemas[action].safeParse({}).success, true, action);
});

test("MIG-0656 U01b: rejects malformed inactive-mode fields that CURRENT validates", () => {
  const time = { mode: "time", start_at: "2026-11-08T10:00",
    end_at: "2026-11-08T10:30", interval_minutes: 5 };
  for (const extra of [
    { count: 0 }, { count: 101 }, { count: "3" }, { count: true },
    { start_index: -1 }, { start_index: 10000 }, { start_index: "1" },
    { label_prefix: "x".repeat(41) }, { label_prefix: 3 },
  ]) assert.equal(SlotGenerateBodySchema.safeParse({ ...time, ...extra }).success, false,
    "time rejects invalid count-mode fields: " + JSON.stringify(extra));
  const count = { mode: "count", count: 3, start_index: 1, label_prefix: "No." };
  for (const extra of [
    { interval_minutes: 0 }, { interval_minutes: 1441 },
    { interval_minutes: "5" }, { interval_minutes: 1.5 },
    { start_at: 42 }, { end_at: {} },
  ]) assert.equal(SlotGenerateBodySchema.safeParse({ ...count, ...extra }).success, false,
    "count rejects invalid time-mode fields: " + JSON.stringify(extra));
});

test("MIG-0656 U01b: valid inactive-mode fields are checked but omitted from output", () => {
  assert.deepEqual(SlotGenerateBodySchema.parse({
    mode: "time", start_at: "2026-11-08T10:00",
    end_at: "2026-11-08T10:30", count: 100,
    start_index: 9999, label_prefix: "  No.  ",
  }), {
    mode: "time", start_at: "2026-11-08T10:00",
    end_at: "2026-11-08T10:30", interval_minutes: 5,
  });
  assert.deepEqual(SlotGenerateBodySchema.parse({
    mode: "count", count: 3, start_index: 1, label_prefix: "No.",
    interval_minutes: 5, start_at: "ignored", end_at: null,
  }), { mode: "count", count: 3, start_index: 1, label_prefix: "No." });
  // Unknown keys are stripped, just as CURRENT's default z.object does.
  assert.deepEqual(SlotGenerateBodySchema.parse({
    mode: "count", count: 1, another_unrecognized_key: "discard",
  }), { mode: "count", count: 1, start_index: 1 });
});
