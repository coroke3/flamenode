/**
 * format ユーティリティの単体テスト。
 * - formatUnix は Asia/Tokyo 固定。test 環境の TZ には依存しない。
 * - formatRelative は Date.now() に依存するので、テスト中の差分が問題にならない範囲だけ確認する。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatUnix,
  formatRelative,
  formatDuration,
  formatCount,
} from "./format.ts";

test("formatUnix: null/undefined はハイフン", () => {
  assert.equal(formatUnix(null), "-");
  assert.equal(formatUnix(undefined), "-");
});

test("formatUnix: invalid inputs return hyphen", () => {
  assert.equal(formatUnix(Number.NaN), "-");
  assert.equal(formatUnix(Infinity), "-");
  assert.equal(formatUnix("not-a-date"), "-");
});

test("formatUnix: 1700000000 (2023-11-14T22:13:20Z = JST 2023/11/15 07:13)", () => {
  const s = formatUnix(1700000000);
  // 日本語ロケール / Asia/Tokyo
  assert.ok(s.includes("2023"));
  assert.ok(s.includes("11"));
  assert.ok(s.includes("15"));
});

test("formatUnix dateOnly: 日付のみ", () => {
  const s = formatUnix(1700000000, { dateOnly: true });
  assert.ok(s.includes("2023"));
  assert.ok(!s.includes(":")); // 時刻 (HH:mm) は含まない
});

test("formatUnix timeOnly: 時刻のみ", () => {
  const s = formatUnix(1700000000, { timeOnly: true });
  assert.ok(s.includes(":"));
  assert.ok(!s.includes("2023"));
});

test("formatRelative: null は空文字", () => {
  assert.equal(formatRelative(null), "");
  assert.equal(formatRelative(undefined), "");
});

test("formatRelative: invalid inputs return empty string", () => {
  assert.equal(formatRelative(Number.NaN), "");
});

test("formatRelative: 30秒前は「今」", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(formatRelative(now - 30), "今");
});

test("formatRelative: 5分前", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.match(formatRelative(now - 5 * 60), /^[0-9]+分前$/);
});

test("formatRelative: 3時間前", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.match(formatRelative(now - 3 * 3600), /時間前$/);
});

test("formatRelative: 2日前", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.match(formatRelative(now - 2 * 86400), /日前$/);
});

test("formatDuration: 秒のみ", () => {
  assert.equal(formatDuration(45), "0:45");
});

test("formatDuration: 分:秒", () => {
  assert.equal(formatDuration(125), "2:05");
});

test("formatDuration: 時:分:秒 (1時間超え)", () => {
  assert.equal(formatDuration(3725), "1:02:05");
});

test("formatDuration: 負の値は 0", () => {
  assert.equal(formatDuration(-5), "0:00");
});

test("formatCount: 1000未満は数字", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(null), "0");
  assert.equal(formatCount(999), "999");
});

test("formatCount: 千〜万", () => {
  assert.equal(formatCount(1500), "1.5k");
  assert.equal(formatCount(9999), "10.0k"); // toFixed(1) で 10.0
});

test("formatCount: 万〜100万", () => {
  assert.equal(formatCount(15000), "15k");
  assert.equal(formatCount(999999), "999k");
});

test("formatCount: 100万以上", () => {
  assert.equal(formatCount(1_500_000), "1.5M");
  assert.equal(formatCount(15_000_000), "15M");
});
