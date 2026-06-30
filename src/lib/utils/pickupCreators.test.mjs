import { test } from "node:test";
import assert from "node:assert/strict";
import {
  comparePickupCreators,
  isPickupCreatorEligible,
  pickupCreatorTotalWorks,
  sortPickupCreators,
} from "./pickupCreators.ts";

test("isPickupCreatorEligible matches old index rules", () => {
  assert.equal(isPickupCreatorEligible({ video_count: 1, collab_count: 0 }), true);
  assert.equal(isPickupCreatorEligible({ video_count: 0, collab_count: 2 }), true);
  assert.equal(isPickupCreatorEligible({ video_count: 0, collab_count: 1 }), false);
  assert.equal(isPickupCreatorEligible({ video_count: 0, collab_count: 0 }), false);
});

test("comparePickupCreators prioritizes total works", () => {
  const rows = [
    { x_name: "kero", video_count: 2, collab_count: 0 },
    { x_name: "さびあさぎ", video_count: 4, collab_count: 0 },
    { x_name: "夏休み", video_count: 1, collab_count: 2 },
  ];
  const sorted = sortPickupCreators(rows);
  assert.deepEqual(
    sorted.map((r) => r.x_name),
    ["さびあさぎ", "夏休み", "kero"],
  );
  assert.equal(pickupCreatorTotalWorks(sorted[0]), 4);
  assert.equal(pickupCreatorTotalWorks(sorted[1]), 3);
});

test("comparePickupCreators breaks ties by personal works", () => {
  const a = { x_name: "A", video_count: 2, collab_count: 1 };
  const b = { x_name: "B", video_count: 3, collab_count: 0 };
  assert.ok(comparePickupCreators(a, b) > 0);
});
