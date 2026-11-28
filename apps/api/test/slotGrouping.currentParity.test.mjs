import assert from "node:assert/strict";
import test from "node:test";

import {
  areSlotsInSamePart,
  buildSlotParts,
  sortSlotsChronologically,
} from "@flamenode/server-core/video/slotGrouping";
import {
  areSlotsInSamePart as currentAreSlotsInSamePart,
  buildSlotParts as currentBuildSlotParts,
  sortSlotsChronologically as currentSortSlotsChronologically,
} from "../../../src/lib/utils/slotGroupingCore.ts";

const fixtures = [
  {
    name: "timed slots preserve exact gap and JST day boundaries",
    gapSec: 900,
    rows: [
      { id: "before-jst-midnight", start_time: -32401, sort_order: 0 },
      { id: "at-jst-midnight", start_time: -32400, sort_order: 0 },
      { id: "same-time", start_time: -32400, sort_order: 1 },
      { id: "exact-gap", start_time: -31500, sort_order: 2 },
      { id: "over-gap", start_time: -30599, sort_order: 3 },
      { id: "next-jst-day", start_time: 54000, sort_order: 4 },
    ],
  },
  {
    name: "untimed rows preserve localeCompare ordering and consecutive sort_order",
    rows: [
      { id: "c", start_time: null, sort_order: 2 },
      { id: "B", start_time: null, sort_order: 1 },
      { id: "a", start_time: null, sort_order: 1 },
      { id: "bad-order", start_time: null, sort_order: Number.MAX_SAFE_INTEGER + 1 },
    ],
  },
  {
    name: "mixed timed and untimed rows never join the same part",
    rows: [
      { id: "untimed-2", start_time: null, sort_order: 2 },
      { id: "timed-1", start_time: 100, sort_order: 1 },
      { id: "untimed-1", start_time: null, sort_order: 1 },
      { id: "timed-2", start_time: 200, sort_order: 2 },
    ],
  },
  {
    name: "non-finite timestamps and unsafe sort_order retain CURRENT handling",
    rows: [
      { id: "infinite-time", start_time: Infinity, sort_order: 1 },
      { id: "nan-time", start_time: NaN, sort_order: 2 },
      { id: "null-time", start_time: null, sort_order: 3 },
      { id: "unsafe-order", start_time: null, sort_order: Number.MAX_SAFE_INTEGER + 1 },
    ],
  },
  {
    name: "invalid gap uses the CURRENT 15 minute fallback",
    gapSec: NaN,
    rows: [
      { id: "gap-first", start_time: 1000, sort_order: 1 },
      { id: "gap-second", start_time: 1900, sort_order: 2 },
      { id: "gap-third", start_time: 2801, sort_order: 3 },
    ],
  },
];

test("server-core slot grouping matches CURRENT ordering, adjacency and part projection", () => {
  for (const fixture of fixtures) {
    const targetSorted = sortSlotsChronologically(fixture.rows);
    const currentSorted = currentSortSlotsChronologically(fixture.rows);
    assert.deepEqual(targetSorted, currentSorted, fixture.name);
    assert.deepEqual(
      buildSlotParts(fixture.rows, fixture.gapSec),
      currentBuildSlotParts(fixture.rows, fixture.gapSec),
      fixture.name,
    );
    for (let index = 1; index < currentSorted.length; index += 1) {
      assert.equal(
        areSlotsInSamePart(currentSorted[index - 1], currentSorted[index], fixture.gapSec),
        currentAreSlotsInSamePart(currentSorted[index - 1], currentSorted[index], fixture.gapSec),
        `${fixture.name} adjacency ${index}`,
      );
    }
  }
});

test("untimed duplicate sort_order keeps the CURRENT localeCompare a/B/c counterexample", () => {
  const rows = [
    { id: "a", start_time: null, sort_order: 1 },
    { id: "B", start_time: null, sort_order: 1 },
    { id: "c", start_time: null, sort_order: 2 },
  ];
  const ordered = sortSlotsChronologically(rows).map(row => row.id);
  assert.deepEqual(ordered, ["a", "B", "c"]);
  assert.deepEqual(
    buildSlotParts(rows).map(part => part.rows.map(row => row.id)),
    [["a"], ["B", "c"]],
  );
});
