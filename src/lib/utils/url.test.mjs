import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeHttpUrl } from "./url.ts";

test("null/空文字は null を返す", () => {
  assert.equal(normalizeHttpUrl(null), null);
  assert.equal(normalizeHttpUrl(undefined), null);
  assert.equal(normalizeHttpUrl(""), null);
  assert.equal(normalizeHttpUrl("   "), null);
});

test("有効な http/https URL は正規化して返す", () => {
  assert.equal(normalizeHttpUrl("https://example.com"), "https://example.com/");
  assert.equal(normalizeHttpUrl("http://example.com/foo/bar?a=1"), "http://example.com/foo/bar?a=1");
});

test("無効なプロトコルは null を返す", () => {
  assert.equal(normalizeHttpUrl("javascript:alert(1)"), null);
  assert.equal(normalizeHttpUrl("data:text/html,evil"), null);
  assert.equal(normalizeHttpUrl("ftp://example.com"), null);
});

test("不正な URL 形式は null を返す", () => {
  assert.equal(normalizeHttpUrl("not-a-url"), null);
  assert.equal(normalizeHttpUrl("http://"), null);
});

test("文字数上限オーバーは null を返す", () => {
  assert.equal(normalizeHttpUrl("https://example.com", { maxLength: 10 }), null);
});
