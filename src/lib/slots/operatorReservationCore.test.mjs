import assert from "node:assert/strict";
import { test } from "node:test";
import { canUseSlotOperatorOverride } from "./operatorReservationCore.ts";

const base = {
  visibility_status: "public",
  start_time: null,
  end_time: null,
  entry_start_time: 2_000,
  entry_end_time: 3_000,
};

test("受付中は運営例外を利用できる", () => {
  assert.equal(canUseSlotOperatorOverride(base, 2_500), true);
});

test("募集開始前は運営例外を利用できる", () => {
  assert.equal(canUseSlotOperatorOverride(base, 1_999), true);
});

test("募集終了後・イベント終了後は運営例外を利用できない", () => {
  assert.equal(canUseSlotOperatorOverride(base, 3_000), false);
  assert.equal(
    canUseSlotOperatorOverride(
      { ...base, entry_end_time: null, end_time: 2_900 },
      2_900,
    ),
    false,
  );
});

test("公開前または募集開始時刻なしは運営例外を利用できない", () => {
  assert.equal(
    canUseSlotOperatorOverride({ ...base, visibility_status: "private" }, 1_000),
    false,
  );
  assert.equal(
    canUseSlotOperatorOverride(
      { ...base, entry_start_time: null, entry_end_time: null },
      1_000,
    ),
    false,
  );
});
