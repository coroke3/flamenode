import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseChapterTime,
  validateChapterTime,
} from "./chapterTime.ts";

test("validateChapterTime rejects invalid mm:ss segments", () => {
  const bad99 = validateChapterTime("1:99");
  assert.equal(bad99.ok, false);
  if (!bad99.ok) assert.equal(bad99.code, "seconds_out_of_range");
  const bad60 = validateChapterTime("1:60");
  assert.equal(bad60.ok, false);
  if (!bad60.ok) assert.equal(bad60.code, "seconds_out_of_range");
});

test("validateChapterTime rejects negative and over-24h values", () => {
  assert.equal(validateChapterTime("-1").ok, false);
  assert.equal(validateChapterTime("-1").code, "negative");
  assert.equal(validateChapterTime("90000").ok, false);
  assert.equal(validateChapterTime("90000").code, "exceeds_day_limit");
  assert.equal(validateChapterTime("25:00:00").ok, false);
});

test("validateChapterTime rejects values beyond video duration", () => {
  const result = validateChapterTime("10:00", { videoDurationSeconds: 300 });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "exceeds_video_duration");
  }
});

test("validateChapterTime rejects malformed separators", () => {
  assert.equal(validateChapterTime("1-30").ok, false);
  assert.equal(validateChapterTime("1;30").ok, false);
  assert.equal(validateChapterTime("::").ok, false);
});

test("validateChapterTime accepts valid values and parseChapterTime wraps it", () => {
  assert.deepEqual(validateChapterTime("1:05"), { ok: true, seconds: 65 });
  assert.equal(parseChapterTime("1:05"), 65);
  assert.equal(parseChapterTime("90"), 90);
});
