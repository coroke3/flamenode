import assert from "node:assert/strict";
import { test } from "node:test";
import {
  YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS,
  resolveYoutubeDailyQuotaUnits,
  youtubeDailyBudgetUnits,
} from "./quotaPolicy.ts";

test("valid decimal daily quotas retain the existing 80% policy", () => {
  for (const [raw, expected] of [
    [undefined, 10_000],
    ["100", 100],
    ["20000", 20_000],
    [" 20000 ", 20_000],
    ["00020000", 20_000],
    ["10000000", 10_000_000],
  ]) {
    assert.equal(resolveYoutubeDailyQuotaUnits(raw), expected, String(raw));
    assert.equal(youtubeDailyBudgetUnits(raw), Math.floor(expected * 0.8), String(raw));
  }
});

test("malformed quota env values cannot be partially parsed into larger Worker budgets", () => {
  for (const raw of [
    "20000junk", "25000.5", "10000000suffix", "20000\nextra",
    "+20000", "-20000", "2e5", "20_000", "０２００００", "abc",
    "99", "10000001", "", " ", "0".repeat(33),
  ]) {
    assert.equal(resolveYoutubeDailyQuotaUnits(raw), YOUTUBE_DEFAULT_DAILY_QUOTA_UNITS, raw);
    assert.equal(youtubeDailyBudgetUnits(raw), 8_000, raw);
  }
  assert.equal(resolveYoutubeDailyQuotaUnits("0".repeat(28) + "20000"), 20_000);
});
