import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

test("sync-jobs health は service と commit を返す", () => {
  assert.match(source, /service:\s*"sync-jobs"/);
  assert.match(source, /BUILD_COMMIT_SHA/);
  assert.match(source, /async fetch\(\s*req: Request,\s*env: Env/);
});
