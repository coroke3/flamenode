import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeUserCss } from "./sanitizeUserCss.ts";

test("null/空文字は空文字を返す", () => {
  assert.equal(sanitizeUserCss(null), "");
  assert.equal(sanitizeUserCss(undefined), "");
  assert.equal(sanitizeUserCss(""), "");
});

test("@import を削除する", () => {
  const out = sanitizeUserCss("@import url('evil.css'); body { color: red; }");
  assert.equal(out.includes("@import"), false);
  assert.ok(out.includes("color: red"));
});

test("危険な表現 expression / behavior / javascript / binding を削除する", () => {
  const out = sanitizeUserCss("div { width: expression(alert(1)); behavior: url(x); color: red; }");
  assert.equal(out.includes("expression"), false);
  assert.equal(out.includes("behavior"), false);
  assert.ok(out.includes("color: red"));
});

test("url() 内の javascript や data スキームを置換する", () => {
  const out = sanitizeUserCss("div { background: url('javascript:alert(1)'); background-image: url(data:image/svg+xml,...); }");
  assert.equal(out.includes("javascript:"), false);
  assert.equal(out.includes("data:"), false);
  assert.ok(out.includes("about:blank"));
});

test("html, body, :root セレクタを .fn-custom-page に置換する", () => {
  const out = sanitizeUserCss("html { margin: 0; } body { padding: 0; } :root { --color: red; }");
  assert.equal(out.includes("html"), false);
  assert.equal(out.includes("body"), false);
  assert.equal(out.includes(":root"), false);
  assert.ok(out.includes(".fn-custom-page"));
});
