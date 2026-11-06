import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPickupCreatorEligible,
  sortPickupCreators,
} from "./pickupCreators.ts";

test("isPickupCreatorEligible matches old index rules", () => {
  assert.equal(isPickupCreatorEligible({ video_count: 1, collab_count: 0 }), true);
  assert.equal(isPickupCreatorEligible({ video_count: 0, collab_count: 2 }), true);
  assert.equal(isPickupCreatorEligible({ video_count: 0, collab_count: 1 }), false);
  assert.equal(isPickupCreatorEligible({ video_count: 0, collab_count: 0 }), false);
});

test("sortPickupCreators prioritizes total works", () => {
  const rows = [
    { x_name: "kero", video_count: 2, collab_count: 0 },
    { x_name: "さびあさぎ", video_count: 4, collab_count: 0 },
    { x_name: "夏休み", video_count: 1, collab_count: 2 },
  ];
  assert.deepEqual(
    sortPickupCreators(rows).map((row) => row.x_name),
    ["さびあさぎ", "夏休み", "kero"],
  );
});

test("sortPickupCreators breaks ties by personal works", () => {
  const rows = [
    { x_name: "A", video_count: 2, collab_count: 1 },
    { x_name: "B", video_count: 3, collab_count: 0 },
  ];
  assert.deepEqual(sortPickupCreators(rows).map((row) => row.x_name), ["B", "A"]);
});

test("invalid creator counts never become eligible or dominate sort order", () => {
  const badCounts = [NaN, Infinity, -Infinity, -1, 0.5, 1.5, Number.MAX_SAFE_INTEGER + 1];
  for (const count of badCounts) {
    assert.equal(isPickupCreatorEligible({ video_count: count, collab_count: 0 }), false, String(count));
    assert.equal(isPickupCreatorEligible({ video_count: 0, collab_count: count }), false, String(count));
  }

  const rows = [
    { x_name: "infinite", video_count: Infinity, collab_count: 0 },
    { x_name: "negative", video_count: -3, collab_count: 0 },
    { x_name: "valid", video_count: 3, collab_count: 0 },
    { x_name: "fractional", video_count: 1.5, collab_count: 0 },
    { x_name: "collab", video_count: 0, collab_count: 2 },
  ];
  assert.deepEqual(
    sortPickupCreators(rows).map((row) => row.x_name),
    ["valid", "collab", "fractional", "infinite", "negative"],
  );
  assert.deepEqual(rows.map((row) => row.x_name), [
    "infinite", "negative", "valid", "fractional", "collab",
  ]);
});

test("valid creator totals still prioritize sum, then personal, then name", () => {
  const rows = [
    { x_name: "collab", video_count: 0, collab_count: 2 },
    { x_name: "personal", video_count: 2, collab_count: 0 },
    { x_name: "many", video_count: 2, collab_count: 1 },
  ];
  assert.deepEqual(
    sortPickupCreators(rows).map((row) => row.x_name),
    ["many", "personal", "collab"],
  );
  assert.equal(isPickupCreatorEligible({ video_count: null, collab_count: 2 }), true);
});
