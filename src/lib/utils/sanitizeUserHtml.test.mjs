/**
 * sanitizeUserHtml の単体テスト。
 * XSS の代表的なベクタが除去されることを確認する。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeUserHtml } from "./sanitizeUserHtml.ts";

test("null/空文字は空文字を返す", () => {
  assert.equal(sanitizeUserHtml(null), "");
  assert.equal(sanitizeUserHtml(undefined), "");
  assert.equal(sanitizeUserHtml(""), "");
});

test("script タグを中身ごと削除", () => {
  const out = sanitizeUserHtml(
    "<p>OK</p><script>alert(1)</script><p>after</p>",
  );
  assert.equal(out.includes("<script"), false);
  assert.equal(out.includes("alert"), false);
  assert.ok(out.includes("OK"));
  assert.ok(out.includes("after"));
});

test("iframe タグを中身ごと削除", () => {
  const out = sanitizeUserHtml('<iframe src="evil"></iframe>');
  assert.equal(out, "");
});

test("style タグを中身ごと削除", () => {
  const out = sanitizeUserHtml("<style>body{display:none}</style><p>OK</p>");
  assert.equal(out.includes("<style"), false);
  assert.equal(out.includes("display:none"), false);
});

test("自己閉じ script タグも削除", () => {
  const out = sanitizeUserHtml("<p>OK</p><script src='x.js' />");
  assert.equal(out.includes("script"), false);
});

test("大文字 SCRIPT も削除", () => {
  const out = sanitizeUserHtml("<SCRIPT>alert(1)</SCRIPT>");
  assert.equal(out.includes("alert"), false);
});

test("onclick 属性を削除", () => {
  const out = sanitizeUserHtml('<a href="#" onclick="alert(1)">x</a>');
  assert.equal(out.includes("onclick"), false);
  assert.equal(out.includes("alert"), false);
});

test("on... 属性 (シングルクオート / クオートなし) も削除", () => {
  const out1 = sanitizeUserHtml(`<a onload='alert(1)'>x</a>`);
  assert.equal(out1.includes("onload"), false);
  const out2 = sanitizeUserHtml(`<a onerror=alert(1)>x</a>`);
  assert.equal(out2.includes("onerror"), false);
});

test("href の javascript: スキームを除去", () => {
  const out = sanitizeUserHtml('<a href="javascript:alert(1)">x</a>');
  assert.equal(out.includes("javascript:"), false);
});

test("src の javascript: スキームを除去", () => {
  const out = sanitizeUserHtml(`<img src="javascript:alert(1)">`);
  assert.equal(out.includes("javascript:"), false);
});

test("data:image/png URL は通過", () => {
  const out = sanitizeUserHtml(
    '<img src="data:image/png;base64,iVBORw0KGgoAAAANSU...">',
  );
  assert.ok(out.includes("data:image/png"));
});

test("data:image/svg+xml URL はブロック", () => {
  const out = sanitizeUserHtml(
    '<img src="data:image/svg+xml;base64,PHN2Zz4...">',
  );
  assert.equal(out.includes("data:image/svg+xml"), false);
});

test("data:text/html URL はブロック", () => {
  const out = sanitizeUserHtml(
    '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  );
  assert.equal(out.includes("data:text/html"), false);
});

test("style 属性を除去する", () => {
  const out = sanitizeUserHtml('<p style="color: red; font-size: 20px;">hello</p>');
  assert.equal(out.includes("style="), false);
  assert.equal(out.includes("color: red"), false);
});

test("通常の安全な HTML は保持", () => {
  const input = '<p>Hello <a href="https://example.com">world</a></p>';
  assert.equal(sanitizeUserHtml(input), input);
});

test("meta refresh も削除", () => {
  const out = sanitizeUserHtml(
    '<meta http-equiv="refresh" content="0;url=evil.com">',
  );
  assert.equal(out.includes("<meta"), false);
});

test("form タグも削除", () => {
  const out = sanitizeUserHtml('<form action="evil"><input></form>');
  assert.equal(out.includes("<form"), false);
});
