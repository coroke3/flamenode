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
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_VALUE, 1441, -1, 0.001]) {
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
