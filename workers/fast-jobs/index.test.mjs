import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

test("fast-jobs health は service と commit を返す", () => {
  assert.match(source, /service:\s*"fast-jobs"/);
  assert.match(source, /BUILD_COMMIT_SHA/);
  assert.match(source, /commit:/);
});
