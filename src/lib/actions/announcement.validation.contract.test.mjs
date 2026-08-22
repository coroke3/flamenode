import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./announcement.ts", import.meta.url), "utf8");

test("announcement flags are integer binary values", () => {
  assert.match(source, /is_published:\s*z\.coerce\.number\(\)\.int\(\)\.min\(0\)\.max\(1\)/);
});
test("announcement datetime input is strict and ordered", () => {
  assert.match(source, /parseJstDatetimeLocalStrict/);
  assert.match(source, /expire\.value <= publish\.value/);
  assert.match(source, /掲載日時の形式が正しくありません/);
});
