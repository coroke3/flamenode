import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveSlotIntervalSec,
  formatDurationJa,
  buildConsecutiveSlotGuidance,
} from "./slotGuidance.ts";

const slots = [{ start_time: 1_700_000_000 }, { start_time: 1_700_000_120 }];
const FALLBACK = "連続枠は、1作品の尺が長い場合に利用してください。複数作品を投稿する場合は、作品ごとに別の枠を確保してください。";

test("valid explicit interval and inferred slot gap retain their original output", () => {
  assert.equal(resolveSlotIntervalSec({ explicitMinutes: 5, slots, partGapSec: 900 }), 300);
  assert.equal(resolveSlotIntervalSec({ explicitMinutes: null, slots, partGapSec: 900 }), 120);
  assert.equal(resolveSlotIntervalSec({ explicitMinutes: 1440, slots: [], partGapSec: 900 }), 86400);
  assert.equal(formatDurationJa(90), "1分30秒");
  assert.equal(formatDurationJa(0), "0秒");
  assert.match(buildConsecutiveSlotGuidance(120), /作品尺が1分30秒以上/);
});

test("overflow, non-finite and sub-second explicit values use a safe inferred interval", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_VALUE, 1441, -1, 0.001, 0.5, 1.5, 30.25, 1439.5]) {
    assert.equal(
      resolveSlotIntervalSec({ explicitMinutes: bad, slots, partGapSec: 900 }),
      120,
      `invalid explicitMinutes ${String(bad)}`,
    );
  }
  assert.equal(resolveSlotIntervalSec({ explicitMinutes: Number.MAX_VALUE, slots: [], partGapSec: 900 }), null);
  assert.equal(resolveSlotIntervalSec({ explicitMinutes: null, slots: [{ start_time: 0 }, { start_time: 100_000 }], partGapSec: Infinity }), null);
});

test("non-finite or out-of-range guidance never contains NaN or Infinity", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_VALUE, 86401, 0, -1]) {
    const result = buildConsecutiveSlotGuidance(bad);
    assert.equal(result, FALLBACK, `invalid intervalSec ${String(bad)}`);
    assert.doesNotMatch(result, /NaN|Infinity/);
  }
  assert.equal(buildConsecutiveSlotGuidance(null), FALLBACK);
  assert.equal(formatDurationJa(Number.NaN), "不明");
  assert.equal(formatDurationJa(Infinity), "不明");
  assert.equal(formatDurationJa(-90), "0秒");
});

test("fractional inferred intervals and direct guidance values fail closed", () => {
  assert.equal(resolveSlotIntervalSec({
    explicitMinutes: null,
    slots: [{ start_time: 100 }, { start_time: 100.25 }],
    partGapSec: 900,
  }), null, "sub-second gaps must not become a misleading zero-second recommendation");
  assert.equal(resolveSlotIntervalSec({
    explicitMinutes: null,
    slots: [{ start_time: 100 }, { start_time: 100.25 }, { start_time: 220.25 }],
    partGapSec: 900,
  }), null, "fractional endpoints must not produce a trusted integer gap");
  for (const value of [0.01, 0.5, 1.5, 120.5]) {
    assert.equal(buildConsecutiveSlotGuidance(value), FALLBACK, String(value));
  }
  assert.match(buildConsecutiveSlotGuidance(1), /作品尺が1秒以上/);
});

test("corrupted fractional or unsafe timestamps cannot manufacture valid-looking gaps", () => {
  for (const times of [
    [100.25, 220.25],
    [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 121],
    [-100.5, 19.5],
  ]) {
    assert.equal(resolveSlotIntervalSec({
      explicitMinutes: null,
      slots: times.map((start_time) => ({ start_time })),
      partGapSec: 900,
    }), null, String(times));
  }
  assert.equal(resolveSlotIntervalSec({
    explicitMinutes: null,
    slots: [
      { start_time: 100.25 }, { start_time: 100 },
      { start_time: 220 }, { start_time: 220.25 },
    ],
    partGapSec: 900,
  }), 120, "valid integer timestamps still determine the gap");
});

test("explicit minute interval obeys eventForm whole-minute range without rounding", () => {
  for (const minutes of [1, 2, 30, 1440]) {
    assert.equal(resolveSlotIntervalSec({ explicitMinutes: minutes, slots: [], partGapSec: 900 }), minutes * 60);
  }
  for (const invalid of [0.5, 1.5, 30.25, 1439.5, 1440.001]) {
    assert.equal(resolveSlotIntervalSec({ explicitMinutes: invalid, slots: [], partGapSec: 900 }), null,
      "fractional or out-of-range explicitMinutes must not be rounded into a trusted interval: " + invalid);
    assert.equal(resolveSlotIntervalSec({ explicitMinutes: invalid, slots, partGapSec: 900 }), 120,
      "invalid explicitMinutes should fall back to valid slot timestamps: " + invalid);
  }
});
