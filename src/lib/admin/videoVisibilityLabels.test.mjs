import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeVideoVisibilityFilter,
  videoVisibilityFilterLabel,
  videoVisibilityGroupForFilter,
  videoVisibilityStatusesForFilter,
} from "./videoVisibilityLabels.ts";

test("videoVisibilityStatusesForFilter groups simplified public statuses", () => {
  assert.deepEqual(videoVisibilityStatusesForFilter("review"), ["pending"]);
  assert.deepEqual(videoVisibilityStatusesForFilter("public"), [
    "public",
    "limited",
  ]);
  assert.deepEqual(videoVisibilityStatusesForFilter("private"), [
    "draft",
    "private",
    "hidden",
  ]);
  assert.deepEqual(videoVisibilityStatusesForFilter("closed"), [
    "archived",
    "voided",
  ]);
});

test("videoVisibilityStatusesForFilter still accepts raw legacy statuses", () => {
  assert.deepEqual(videoVisibilityStatusesForFilter("limited"), ["limited"]);
  assert.deepEqual(videoVisibilityStatusesForFilter("hidden"), ["hidden"]);
  assert.equal(videoVisibilityGroupForFilter("limited"), "public");
  assert.equal(videoVisibilityGroupForFilter("hidden"), "private");
});

test("normalizeVideoVisibilityFilter prevents unknown query values becoming all rows", () => {
  assert.equal(normalizeVideoVisibilityFilter("all"), "");
  assert.equal(normalizeVideoVisibilityFilter(" public "), "public");
  assert.equal(normalizeVideoVisibilityFilter([" hidden ", "public"]), "hidden");
  assert.equal(normalizeVideoVisibilityFilter("bad-status"), "");
  assert.equal(normalizeVideoVisibilityFilter("bad-status", "review"), "review");
  assert.equal(normalizeVideoVisibilityFilter(["bad-status"], "review"), "review");
});

test("videoVisibilityFilterLabel uses simplified labels for groups", () => {
  assert.equal(videoVisibilityFilterLabel("review"), "審査待ち");
  assert.equal(videoVisibilityFilterLabel("closed"), "終了・無効");
  assert.equal(videoVisibilityFilterLabel("limited"), "限定公開");
});
