import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChapterTimeInput } from "./chapterTime.ts";

test("秒数と小数秒を解析する", () => {
  assert.equal(parseChapterTimeInput("83"), 83);
  assert.equal(parseChapterTimeInput("83.5"), 83.5);
  assert.equal(parseChapterTimeInput(" 83.025 "), 83.025);
});

test("分:秒を解析する", () => {
  assert.equal(parseChapterTimeInput("1:23"), 83);
  assert.equal(parseChapterTimeInput("1:23.5"), 83.5);
  assert.equal(parseChapterTimeInput("1234:56.007"), 74096.007);
});

test("時:分:秒を分:秒の小数として誤解釈しない", () => {
  assert.equal(parseChapterTimeInput("1:23:45"), 5025);
  assert.equal(parseChapterTimeInput("01:02:03.25"), 3723.25);
});

test("曖昧または範囲外の形式を拒否する", () => {
  assert.equal(parseChapterTimeInput(""), null);
  assert.equal(parseChapterTimeInput("1:60"), null);
  assert.equal(parseChapterTimeInput("1:23:4"), null);
  assert.equal(parseChapterTimeInput("1:23:45:6"), null);
  assert.equal(parseChapterTimeInput("86400.001"), null);
  assert.equal(parseChapterTimeInput("-1"), null);
  assert.equal(parseChapterTimeInput("abc"), null);
});
