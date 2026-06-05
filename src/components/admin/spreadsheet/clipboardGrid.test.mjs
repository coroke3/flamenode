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
