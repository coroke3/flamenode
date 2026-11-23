import assert from "node:assert/strict";
import test from "node:test";
import {
  areSlotsInSamePart,
  sortSlotsChronologically,
} from "./slotGroupingCore.ts";

test("valid slot start times sort before non-finite values, including epoch zero", () => {
  const rows = [
    { id: "invalid-nan", start_time: NaN, sort_order: 9 },
    { id: "finite-later", start_time: 90, sort_order: 0 },
    { id: "invalid-infinity", start_time: Infinity, sort_order: 3 },
    { id: "untimed", start_time: null, sort_order: 2 },
    { id: "finite-epoch", start_time: 0, sort_order: 7 },
  ];
  const result = sortSlotsChronologically(rows);
  assert.deepEqual(result.map((row) => row.id), [
    "finite-epoch",
    "finite-later",
    "untimed",
    "invalid-infinity",
    "invalid-nan",
  ]);
  assert.deepEqual(rows.map((row) => row.id), [
    "invalid-nan",
    "finite-later",
    "invalid-infinity",
    "untimed",
    "finite-epoch",
  ]);
});

test("non-finite sort_order still falls back to the stable id tie-breaker", () => {
  const rows = [
    { id: "z", start_time: null, sort_order: NaN },
    { id: "a", start_time: null, sort_order: null },
    { id: "c", start_time: null, sort_order: Infinity },
    { id: "b", start_time: null, sort_order: 0 },
  ];
  assert.deepEqual(
    sortSlotsChronologically(rows).map((row) => row.id),
    ["a", "b", "c", "z"],
  );
});

test("non-finite timestamps never pass slot adjacency checks", () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.equal(
      areSlotsInSamePart(
        { start_time: invalid, sort_order: 1 },
        { start_time: 100, sort_order: 2 },
      ),
      false,
    );
    assert.equal(
      areSlotsInSamePart(
        { start_time: invalid, sort_order: 1 },
        { start_time: null, sort_order: 2 },
      ),
      false,
    );
  }
});
