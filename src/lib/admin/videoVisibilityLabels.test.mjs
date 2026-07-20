import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeVideoVisibilityFilter,
  videoVisibilityFilterLabel,
  videoVisibilityGroupForFilter,
  videoVisibilityStatusesForFilter,
} from "./videoVisibilityLabels.ts";

test("video visibility groups contain the four canonical states", () => {
  assert.deepEqual(videoVisibilityStatusesForFilter("review"), ["pending"]);
  assert.deepEqual(videoVisibilityStatusesForFilter("public"), ["public"]);
  assert.deepEqual(videoVisibilityStatusesForFilter("private"), ["private"]);
  assert.deepEqual(videoVisibilityStatusesForFilter("closed"), ["voided"]);
});

test("removed statuses are rejected", () => {
  for (const value of ["draft", "limited", "hidden", "archived"]) {
    assert.equal(videoVisibilityStatusesForFilter(value), null);
    assert.equal(videoVisibilityGroupForFilter(value), null);
  }
});

test("visibility query normalization rejects unknown values", () => {
  assert.equal(normalizeVideoVisibilityFilter("all"), "");
  assert.equal(normalizeVideoVisibilityFilter(" public "), "public");
  assert.equal(normalizeVideoVisibilityFilter("limited"), "");
  assert.equal(normalizeVideoVisibilityFilter("bad-status", "review"), "review");
});

test("group labels use the simplified wording", () => {
  assert.equal(videoVisibilityFilterLabel("review"), "審査待ち");
  assert.equal(videoVisibilityFilterLabel("closed"), "無効");
  assert.equal(videoVisibilityFilterLabel("public"), "公開");
});
