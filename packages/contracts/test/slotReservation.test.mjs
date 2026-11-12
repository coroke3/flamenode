import assert from "node:assert/strict";
import test from "node:test";
import { MAX_SLOTS_PER_VIDEO } from "@flamenode/domain/slots/limits";
import {
  SlotReserveBodySchema,
  SlotReleaseBodySchema,
  SlotExtendBodySchema,
  SlotMergeBodySchema,
  SlotMutationResultSchema,
  isSlotOperatorOverrideRequested,
} from "../src/slotReservation.ts";

test("SA-065: count bound stays identical to CURRENT domain", () => {
  // packages/contracts must not depend on @flamenode/domain at runtime.
  assert.equal(MAX_SLOTS_PER_VIDEO, 20);
  const base = { display_name: "  出演者  " };
  assert.deepEqual(SlotReserveBodySchema.parse(base), {
    display_name: "出演者",
    consecutive_count: 1,
  });
  for (const count of [1, 2, 20, "1", "02", "20"]) {
    const result = SlotReserveBodySchema.parse({ ...base, consecutive_count: count });
    assert.equal(result.consecutive_count, Number(count));
  }
  for (const count of [0, 21, -1, 1.5, "0", "21", "-1", "1.5", "NaN", "", " ", null, true, false, Number.POSITIVE_INFINITY]) {
    assert.equal(
      SlotReserveBodySchema.safeParse({ ...base, consecutive_count: count }).success,
      false,
      `invalid consecutive_count ${String(count)}`,
    );
  }
});

test("SA-065: name required, trimmed, at most 80 characters", () => {
  assert.equal(SlotReserveBodySchema.safeParse({ display_name: "" }).success, false);
  assert.equal(SlotReserveBodySchema.safeParse({ display_name: "  " }).success, false);
  assert.equal(SlotReserveBodySchema.parse({ display_name: "a".repeat(80) }).display_name.length, 80);
  assert.equal(SlotReserveBodySchema.safeParse({ display_name: "a".repeat(81) }).success, false);
  assert.equal(SlotReserveBodySchema.safeParse({ display_name: 123 }).success, false);
});

test("SA-065/067/068: override only accepts CURRENT true values", () => {
  for (const value of [true, "1", "true", "on", " TRUE ", "On"]) {
    assert.equal(isSlotOperatorOverrideRequested(value), true);
  }
  for (const value of [false, "0", "false", "off", "", "yes", undefined]) {
    assert.equal(isSlotOperatorOverrideRequested(value), false);
  }
  assert.equal(SlotReserveBodySchema.safeParse({ display_name: "ok", operator_override: 1 }).success, false);
  assert.equal(SlotExtendBodySchema.safeParse({ direction: "forward", operator_override: "1" }).success, true);
  assert.equal(SlotMergeBodySchema.safeParse({ gap_slot_id: "g", display_name: "ok", operator_override: true }).success, true);
});

test("SA-066/067: release is body-free, extend requires exact direction", () => {
  assert.deepEqual(SlotReleaseBodySchema.parse({}), {});
  assert.equal(SlotReleaseBodySchema.safeParse({ slot_id: "untrusted-body-id" }).success, false);
  assert.deepEqual(SlotExtendBodySchema.parse({ direction: "backward" }), { direction: "backward" });
  assert.deepEqual(SlotExtendBodySchema.parse({ direction: "forward" }), { direction: "forward" });
  for (const direction of [undefined, "", "previous", 1, null]) {
    assert.equal(SlotExtendBodySchema.safeParse({ direction }).success, false);
  }
});

test("SA-068: merge requires a gap slot and bounded display name", () => {
  assert.deepEqual(
    SlotMergeBodySchema.parse({ gap_slot_id: "  gap-1 ", display_name: "  参加者 " }),
    { gap_slot_id: "gap-1", display_name: "参加者" },
  );
  for (const invalid of [
    { gap_slot_id: "", display_name: "x" },
    { gap_slot_id: " ", display_name: "x" },
    { gap_slot_id: "g", display_name: "" },
    { gap_slot_id: "g", display_name: "x".repeat(81) },
  ]) assert.equal(SlotMergeBodySchema.safeParse(invalid).success, false);
});

test("SA-065..068: response DTO covers CURRENT result without DB row leak", () => {
  assert.deepEqual(
    SlotMutationResultSchema.parse({
      ok: true, slotId: "slot1", slotCount: 2, groupSize: 2,
      pendingPublicReflection: true,
    }),
    { ok: true, slotId: "slot1", slotCount: 2, groupSize: 2, pendingPublicReflection: true },
  );
  assert.deepEqual(SlotMutationResultSchema.parse({
    ok: false, reason: "maintenance", message: "受付停止中です。",
  }), { ok: false, reason: "maintenance", message: "受付停止中です。" });
  assert.equal(SlotMutationResultSchema.safeParse({
    ok: true, slotId: "x", slotCount: 0, groupSize: 0,
  }).success, false);
});
