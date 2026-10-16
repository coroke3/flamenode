import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { renderTokensCss, TOKENS_CSS, TOKENS_JSON } from "./generate-ui-tokens.mjs";

const tokens = JSON.parse(fs.readFileSync(TOKENS_JSON, "utf8"));

test("committed tokens.css matches tokens.json", () => {
  assert.equal(fs.readFileSync(TOKENS_CSS, "utf8"), renderTokensCss(tokens));
});

test("theme tokens reference palette variables in both themes", () => {
  const css = renderTokensCss(tokens);
  assert.match(css, /\[data-theme="dark"\] \{\n  --bg: var\(--black\);/);
  assert.match(css, /\[data-theme="light"\] \{\n  --bg: var\(--white\);/);
});

test("rendering is deterministic", () => {
  assert.equal(renderTokensCss(tokens), renderTokensCss(structuredClone(tokens)));
});
