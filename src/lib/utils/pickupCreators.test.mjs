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
