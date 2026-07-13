import assert from "node:assert/strict";
import { test } from "node:test";
import {
  YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS,
  YOUTUBE_TARGET_USAGE_PERCENT,
  resolveYoutubeDailyQuotaUnits,
  youtubeDailyBudgetUnits,
  youtubeQuotaDay,
} from "../../src/lib/youtube/quotaPolicy.ts";
import {
  refundYoutubeQuota,
  reserveYoutubeQuota,
} from "./quotaBudget.ts";

function createDb(firstResult = { used_units: 8_000 }) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...bindings) {
          calls.push({ sql, bindings });
          return {
            async first() {
              return firstResult;
            },
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
  };
}

test("標準quota 10000の80%をFlameNode上限にする", () => {
  assert.equal(YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS, 10_000);
  assert.equal(YOUTUBE_TARGET_USAGE_PERCENT, 80);
  assert.equal(resolveYoutubeDailyQuotaUnits(undefined), 10_000);
  assert.equal(youtubeDailyBudgetUnits(undefined), 8_000);
  assert.equal(youtubeDailyBudgetUnits("20000"), 16_000);
  assert.equal(youtubeDailyBudgetUnits("invalid"), 8_000);
});

test("quota日付は太平洋時間0時で切り替わる", () => {
  assert.equal(youtubeQuotaDay(new Date("2026-07-13T06:59:59Z")), "2026-07-12");
  assert.equal(youtubeQuotaDay(new Date("2026-07-13T07:00:00Z")), "2026-07-13");
});

test("quota予約はD1 UPSERTで上限超過を原子的に拒否する", async () => {
  const db = createDb({ used_units: 8 });
  const reservation = await reserveYoutubeQuota(
    { DB: db, YOUTUBE_DAILY_QUOTA_LIMIT: "10000" },
    8,
    1_752_388_800,
  );
  assert.equal(reservation?.reservedUnits, 8);
  assert.equal(reservation?.dailyBudgetUnits, 8_000);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /ON CONFLICT\(provider, quota_day\)/);
  assert.match(db.calls[0].sql, /used_units \+ excluded\.used_units <= excluded\.limit_units/);
  assert.deepEqual(db.calls[0].bindings.slice(0, 4), ["youtube", "2025-07-12", 8, 8_000]);
});

test("日次予算を超える予約はD1を呼ばず拒否する", async () => {
  const db = createDb();
  const reservation = await reserveYoutubeQuota(
    { DB: db, YOUTUBE_DAILY_QUOTA_LIMIT: "10000" },
    8_001,
    1_752_388_800,
  );
  assert.equal(reservation, null);
  assert.equal(db.calls.length, 0);
});

test("未使用予約だけを同じquota日へ返却する", async () => {
  const db = createDb();
  await refundYoutubeQuota(
    { DB: db },
    {
      quotaDay: "2026-07-13",
      reservedUnits: 8,
      usedUnits: 8,
      dailyBudgetUnits: 8_000,
    },
    5,
    1_752_388_800,
  );
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /MAX\(0, used_units - \?3\)/);
  assert.deepEqual(db.calls[0].bindings.slice(0, 3), ["youtube", "2026-07-13", 5]);
});
