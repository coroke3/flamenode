import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminSpreadsheetDisabled } from "../.test-dist/apps/ops/src/routes/admin/AdminSpreadsheetDisabled.js";

test("MIG-0737 U01: disabled spreadsheet page preserves CURRENT heading and instructions", () => {
  const html = renderToStaticMarkup(React.createElement(AdminSpreadsheetDisabled));
  assert.match(html, /<h1 id="admin-spreadsheet-disabled-title">DB スプレッドシート<\/h1>/);
  assert.match(html, /この機能は環境変数で有効化する必要があります。/);
  assert.match(html, /ADMIN_SPREADSHEET_ENABLED=true/);
  assert.match(html, /ADMIN_SPREADSHEET_ENABLED=&quot;true&quot;/);
  assert.match(html, /\.dev\.vars/);
  assert.match(html, /npm run dev/);
  assert.match(html, /href="\/admin"[^>]*>ダッシュボードへ戻る<\/a>/);
});

test("MIG-0737 U01: disabled view remains an accessible, non-mutation explanation", () => {
  const html = renderToStaticMarkup(React.createElement(AdminSpreadsheetDisabled));
  assert.match(html, /<section aria-labelledby="admin-spreadsheet-disabled-title"/);
  assert.match(html, /<ol[^>]*>.*<li>.*<li>/s);
  assert.doesNotMatch(html, /<form|<input|<button|data-action|type="submit"/);
});
