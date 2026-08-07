import assert from "node:assert/strict";
import test from "node:test";
import { jstDayKey, needsNostalgicDailyReshuffle } from "./topNostalgicDaily.ts";
import { pickNostalgicDisplay } from "./topNostalgicShuffle.ts";

test("pickNostalgicDisplay はプールから上限件数だけ返す", () => {
  const pool = Array.from({ length: 30 }, (_, index) => index);
  const picked = pickNostalgicDisplay(pool, 20);
  assert.equal(picked.length, 20);
  assert.equal(new Set(picked).size, 20);
  for (const item of picked) {
    assert.ok(pool.includes(item));
  }
});

test("jstDayKey と needsNostalgicDailyReshuffle は JST 日単位で判定する", () => {
  const dayStart = Math.floor(Date.parse("2026-07-30T01:00:00.000Z") / 1000);
  const sameDay = Math.floor(Date.parse("2026-07-30T14:59:00.000Z") / 1000);
  const nextDay = Math.floor(Date.parse("2026-07-30T15:00:00.000Z") / 1000);

  assert.equal(jstDayKey(dayStart), "2026-07-30");
  assert.equal(jstDayKey(sameDay), "2026-07-30");
  assert.equal(jstDayKey(nextDay), "2026-07-31");
  assert.equal(needsNostalgicDailyReshuffle(dayStart, sameDay), false);
  assert.equal(needsNostalgicDailyReshuffle(dayStart, nextDay), true);
  assert.equal(needsNostalgicDailyReshuffle(null, sameDay), true);
});
