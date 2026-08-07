import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_SLOTS_PER_VIDEO,
  MIN_SLOTS_PER_VIDEO,
  normalizeMaxSlotsPerVideo,
} from "./limits.ts";

test("normalizeMaxSlotsPerVideo clamps to domain bounds", () => {
  assert.equal(normalizeMaxSlotsPerVideo(null), MIN_SLOTS_PER_VIDEO);
  assert.equal(normalizeMaxSlotsPerVideo(0), MIN_SLOTS_PER_VIDEO);
  assert.equal(normalizeMaxSlotsPerVideo(5), 5);
  assert.equal(normalizeMaxSlotsPerVideo(MAX_SLOTS_PER_VIDEO), MAX_SLOTS_PER_VIDEO);
  assert.equal(normalizeMaxSlotsPerVideo(99), MAX_SLOTS_PER_VIDEO);
});
