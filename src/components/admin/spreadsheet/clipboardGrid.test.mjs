import test from "node:test";
import assert from "node:assert/strict";
import { parseHtmlClipboardTable } from "../../../lib/utils/clipboardHtml.ts";
import {
  parseClipboardContent,
  looksLikeTabularClipboard,
} from "../../../lib/utils/clipboardParse.ts";

test("parseHtmlClipboardTable reads Excel-style table", () => {
  const html = `<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>`;
  const grid = parseHtmlClipboardTable(html);
  assert.deepEqual(grid, [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("parseClipboardContent prefers TSV from Excel plain text", () => {
  const plain = "col1\tcol2\nv1\tv2";
  const grid = parseClipboardContent(plain, "");
  assert.deepEqual(grid, [
    ["col1", "col2"],
    ["v1", "v2"],
  ]);
});

test("parseClipboardContent falls back to HTML when plain is empty", () => {
  const html = `<table><tr><td>x</td><td>y</td></tr></table>`;
  const grid = parseClipboardContent("", html);
  assert.deepEqual(grid, [["x", "y"]]);
});

test("looksLikeTabularClipboard detects multi-cell HTML", () => {
  const html = `<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>`;
  assert.equal(looksLikeTabularClipboard("", html), true);
});

test("HTML clipboard fallback preserves astral Unicode in decimal and hex references", () => {
  const html = "<table><tr><td>&#128640;</td><td>&#x1F680;</td><td>&#X1f680;</td></tr></table>";
  assert.deepEqual(parseHtmlClipboardTable(html), [["🚀", "🚀", "🚀"]]);
  assert.deepEqual(parseClipboardContent("", html), [["🚀", "🚀", "🚀"]]);
});

test("HTML clipboard fallback replaces invalid Unicode scalar references", () => {
  const html = "<table><tr><td>&#0;</td><td>&#55296;</td><td>&#x110000;</td><td>&#99999999999999999999999;</td></tr></table>";
  assert.deepEqual(parseHtmlClipboardTable(html), [["�", "�", "�", "�"]]);
});

test("HTML clipboard fallback retains valid BMP references and named entities", () => {
  const html = '<table><tr><td>&#12354;</td><td>&#x3042;</td><td>&lt;test&gt; &amp; &quot;ok&quot;</td></tr></table>';
  assert.deepEqual(parseHtmlClipboardTable(html), [["あ", "あ", '<test> & "ok"']]);
});
