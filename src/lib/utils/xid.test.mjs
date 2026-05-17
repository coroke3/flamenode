/**
 * X ID 正規化/バリデーションの単体テスト。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeXId, isValidXId } from "./xid.ts";

test("normalizeXId: @ を取り除き小文字化", () => {
  assert.equal(normalizeXId("@FooBar"), "foobar");
  assert.equal(normalizeXId("@@@Foo"), "foo");
  assert.equal(normalizeXId("FOO"), "foo");
});

test("normalizeXId: 前後の空白を削除", () => {
  assert.equal(normalizeXId("  bar  "), "bar");
});

test("normalizeXId: null/undefined は空文字", () => {
  assert.equal(normalizeXId(null), "");
  assert.equal(normalizeXId(undefined), "");
  assert.equal(normalizeXId(""), "");
});

test("isValidXId: 有効な ID", () => {
  assert.equal(isValidXId("foo_bar"), true);
  assert.equal(isValidXId("abc123"), true);
  assert.equal(isValidXId("@User_1"), true); // @ は normalize で外れる
  assert.equal(isValidXId("a"), true);
  assert.equal(isValidXId("x".repeat(32)), true);
});

test("isValidXId: 無効な ID", () => {
  assert.equal(isValidXId(""), false);
  assert.equal(isValidXId(null), false);
  assert.equal(isValidXId("x".repeat(33)), false); // 長すぎ
  assert.equal(isValidXId("user-name"), false); // - は不可
  assert.equal(isValidXId("user name"), false); // 空白
  assert.equal(isValidXId("user.name"), false); // .
  assert.equal(isValidXId("usér"), false); // 非ASCII
});
