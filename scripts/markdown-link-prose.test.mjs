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
