/**
 * validateNotificationPayload の単体テスト。
 * 実行: npm run test:notif (または node --test --experimental-strip-types src/lib/notifications/format.test.mjs)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateNotificationPayload } from "./format.ts";

test("正常系: 最小限の type + payload で OK", () => {
  const r = validateNotificationPayload("video_approved", { content: "ok" });
  assert.equal(r.ok, true);
});

test("type が空文字なら NG", () => {
  const r = validateNotificationPayload("", { content: "ok" });
  assert.equal(r.ok, false);
});

test("type が文字列でないなら NG", () => {
  const r = validateNotificationPayload(null, { content: "ok" });
  assert.equal(r.ok, false);
  const r2 = validateNotificationPayload(123, { content: "ok" });
  assert.equal(r2.ok, false);
});

test("type に不正文字 (ハイフン) があれば NG", () => {
  const r = validateNotificationPayload("video-approved", { content: "ok" });
  assert.equal(r.ok, false);
});

test("type 長すぎ (65 文字) は NG", () => {
  const longType = "x".repeat(65);
  const r = validateNotificationPayload(longType, { content: "ok" });
  assert.equal(r.ok, false);
});

test("payload が null / 配列なら NG", () => {
  assert.equal(validateNotificationPayload("ok", null).ok, false);
  assert.equal(validateNotificationPayload("ok", []).ok, false);
});

test("payload.content が文字列以外なら NG", () => {
  const r = validateNotificationPayload("ok", { content: 123 });
  assert.equal(r.ok, false);
});

test("payload.content が 1001 文字なら NG", () => {
  const r = validateNotificationPayload("ok", { content: "a".repeat(1001) });
  assert.equal(r.ok, false);
});

test("payload が 8KB を超えると NG", () => {
  const big = "a".repeat(8 * 1024 + 100);
  const r = validateNotificationPayload("ok", { data: big });
  assert.equal(r.ok, false);
});

test("payload に content がなくても他のキーがあれば OK", () => {
  const r = validateNotificationPayload("custom_event", { video_id: "vid_1" });
  assert.equal(r.ok, true);
});
