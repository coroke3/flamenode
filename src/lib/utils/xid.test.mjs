/**
 * X ID 正規化の単体テスト。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeXId } from "./xid.ts";

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
