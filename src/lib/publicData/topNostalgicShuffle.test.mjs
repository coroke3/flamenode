import assert from "node:assert/strict";
import test from "node:test";
import {
  needsNostalgicDailyReshuffle,
  pickNostalgicDisplay,
  utcDayKey,
} from "./topNostalgicShuffle.ts";

test("pickNostalgicDisplay はプールから上限件数だけ返す", () => {
  const pool = Array.from({ length: 30 }, (_, index) => index);
  const picked = pickNostalgicDisplay(pool, 20);
  assert.equal(picked.length, 20);
  assert.equal(new Set(picked).size, 20);
  for (const item of picked) {
    assert.ok(pool.includes(item));
  }
});

test("utcDayKey と needsNostalgicDailyReshuffle は UTC 日単位で判定する", () => {
  const dayStart = Math.floor(Date.parse("2026-07-30T12:00:00.000Z") / 1000);
  const sameDay = dayStart + 3600;
  const nextDay = Math.floor(Date.parse("2026-07-31T00:00:01.000Z") / 1000);

  assert.equal(utcDayKey(dayStart), "2026-07-30");
  assert.equal(needsNostalgicDailyReshuffle(dayStart, sameDay), false);
  assert.equal(needsNostalgicDailyReshuffle(dayStart, nextDay), true);
  assert.equal(needsNostalgicDailyReshuffle(null, sameDay), true);
});
