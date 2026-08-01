/**
 * X ID 正規化の単体テスト。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeXId, parseXIdentityInput } from "./xid.ts";

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

test("parseXIdentityInput: 仕様例はすべて coroke3", () => {
  for (const input of [
    "coroke3",
    "@coroke3",
    " https://x.com/coroke3",
    "https://www.x.com/coroke3/",
    "https://twitter.com/coroke3",
    "https://www.twitter.com/coroke3/",
    "https://x.com/coroke3?ref=test",
  ]) {
    assert.equal(parseXIdentityInput(input), "coroke3", input);
  }
});

test("parseXIdentityInput: 拒否対象", () => {
  assert.equal(parseXIdentityInput("https://example.com/coroke3"), null);
  assert.equal(parseXIdentityInput("@co-ro"), null);
  assert.equal(parseXIdentityInput("coroke 3"), null);
  assert.equal(parseXIdentityInput(""), null);
  assert.equal(parseXIdentityInput("a".repeat(21)), null);
  assert.equal(parseXIdentityInput("https://x.com/coroke3/status/1"), null);
});
