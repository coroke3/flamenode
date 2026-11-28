import assert from "node:assert/strict";
import test from "node:test";
import { slotPartGapSec as canonical } from "../src/slots/partGap.ts";
import { slotPartGapSec as legacy } from "../../../src/lib/slots/slotPartGap.ts";

test("MIG-0657 U01: CURRENT bridge uses the same slot-part gap function", () => {
  assert.strictEqual(legacy, canonical);
});

test("MIG-0657 U01: gap minutes preserve the CURRENT conversion and fallback", () => {
  for (const [input, expected] of [
    [{}, 900],
    [{ slot_part_gap_minutes: null }, 900],
    [{ slot_part_gap_minutes: 0 }, 0],
    [{ slot_part_gap_minutes: 2.5 }, 150],
    [{ slot_part_gap_minutes: 15 }, 900],
    [{ slot_part_gap_minutes: 120 }, 7200],
    [{ slot_part_gap_minutes: -1 }, 900],
    [{ slot_part_gap_minutes: Number.NaN }, 900],
    [{ slot_part_gap_minutes: Number.POSITIVE_INFINITY }, 900],
    [{ slot_part_gap_minutes: Number.NEGATIVE_INFINITY }, 900],
    [{ slot_part_gap_minutes: "12" }, 900],
  ]) {
    assert.strictEqual(canonical(input), expected);
    assert.strictEqual(legacy(input), expected);
  }
  assert.strictEqual(Object.is(canonical({ slot_part_gap_minutes: -0 }), -0), true);
});
