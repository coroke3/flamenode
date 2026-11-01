import assert from "node:assert/strict";
import { test } from "node:test";
import { proseOutsideFencedCode } from "./markdown-link-prose.mjs";

const ticks = String.fromCharCode(96);
const fence = ticks.repeat(3);

test("preserves real prose links but skips examples in a backtick fence", () => {
  const markdown = [
    "[real](real.md)",
    fence + "markdown",
    "[example](missing.md)",
    fence,
    "[after](after.md)",
  ].join("\n");
  const result = proseOutsideFencedCode(markdown);
  assert.match(result, /real\.md/);
  assert.doesNotMatch(result, /missing\.md/);
  assert.match(result, /after\.md/);
});

test("tilde fences require the correct closing character and length", () => {
  const markdown = [
    "~~~~js",
    "[example](ignored.md)",
    fence,
    "~~~",
    "[still code](ignored-too.md)",
    "~~~~~~",
    "[real](visible.md)",
  ].join("\n");
  const result = proseOutsideFencedCode(markdown);
  assert.doesNotMatch(result, /ignored/);
  assert.match(result, /visible\.md/);
});

test("unterminated fences mask the remaining code", () => {
  const result = proseOutsideFencedCode("[real](real.md)\n  " + fence + "txt\n[fake](fake.md)");
  assert.match(result, /real\.md/);
  assert.doesNotMatch(result, /fake\.md/);
});

test("inline backticks and four-space indented text are not fences", () => {
  const markdown = "Inline " + fence + "[ref](real.md)" + fence + "\n    " + fence + "\n[link](another.md)";
  const result = proseOutsideFencedCode(markdown);
  assert.match(result, /real\.md/);
  assert.match(result, /another\.md/);
});

test("backticks in a fence info string are not a valid opener", () => {
  const result = proseOutsideFencedCode(fence + "lang" + ticks + "invalid\n[real](real.md)");
  assert.match(result, /real\.md/);
});

test("CRLF and up to three leading spaces in tilde fences", () => {
  const markdown = "[one](one.md)\r\n ~~~ markdown\r\n[bad](bad.md)\r\n ~~~\r\n[two](two.md)";
  const result = proseOutsideFencedCode(markdown);
  assert.match(result, /one\.md/);
  assert.doesNotMatch(result, /bad\.md/);
  assert.match(result, /two\.md/);
});

test("fences inside blockquotes are masked", () => {
  const markdown = [
    "> " + fence + "md",
    "> [example](bq-missing.md)",
    "> " + fence,
    "[after](after.md)",
  ].join("\n");
  const result = proseOutsideFencedCode(markdown);
  assert.doesNotMatch(result, /bq-missing/);
  assert.match(result, /after\.md/);
});

test("fences inside nested blockquotes are masked", () => {
  const markdown = [
    "> > " + fence,
    "> > [example](nested-missing.md)",
    "> > " + fence,
    "> [quoted](quoted.md)",
  ].join("\n");
  const result = proseOutsideFencedCode(markdown);
  assert.doesNotMatch(result, /nested-missing/);
  assert.match(result, /quoted\.md/);
});

test("blockquote fence ends when the quote ends", () => {
  const markdown = "> " + fence + "\n> [x](a-missing.md)\n\n[real](real.md)";
  const result = proseOutsideFencedCode(markdown);
  assert.doesNotMatch(result, /a-missing/);
  assert.match(result, /real\.md/);
});

test("fences nested in list items are masked", () => {
  const markdown = [
    "- item",
    "    " + fence + "md",
    "    [example](list-missing.md)",
    "    " + fence,
    "    [in item](item.md)",
    "1. " + fence,
    "   [ex2](list2-missing.md)",
    "   " + fence,
    "",
    "[outside](outside.md)",
  ].join("\n");
  const result = proseOutsideFencedCode(markdown);
  assert.doesNotMatch(result, /missing/);
  assert.match(result, /item\.md/);
  assert.match(result, /outside\.md/);
});
