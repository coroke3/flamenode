import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_SLOTS_PER_VIDEO,
  MAX_SLOTS_PER_VIDEO,
  normalizeMaxSlotsPerVideo,
} from "@flamenode/domain/slots/limits";

test("limits: normalizeMaxSlotsPerVideo handles boundary and invalid values", () => {
  assert.equal(MIN_SLOTS_PER_VIDEO, 1);
  assert.equal(MAX_SLOTS_PER_VIDEO, 20);

  // Invalid values fallback to MIN_SLOTS_PER_VIDEO (1)
  assert.equal(normalizeMaxSlotsPerVideo(undefined), 1);
  assert.equal(normalizeMaxSlotsPerVideo(null), 1);
  assert.equal(normalizeMaxSlotsPerVideo(NaN), 1);
  assert.equal(normalizeMaxSlotsPerVideo("invalid"), 1);

  // Clamping to [1, 20]
  assert.equal(normalizeMaxSlotsPerVideo(0), 1);
  assert.equal(normalizeMaxSlotsPerVideo(-5), 1);
  assert.equal(normalizeMaxSlotsPerVideo(1), 1);
  assert.equal(normalizeMaxSlotsPerVideo(10), 10);
  assert.equal(normalizeMaxSlotsPerVideo(15.7), 15);
  assert.equal(normalizeMaxSlotsPerVideo(20), 20);
  assert.equal(normalizeMaxSlotsPerVideo(21), 20);
  assert.equal(normalizeMaxSlotsPerVideo(100), 20);
});
