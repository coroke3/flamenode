import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");

test("content-jobs health は service と commit を返す", () => {
  assert.match(source, /service:\s*"content-jobs"/);
  assert.match(source, /BUILD_COMMIT_SHA/);
});

test("無認証 rebuild / process-queue を拒否する", () => {
  assert.match(source, /rejectUnauthorizedWorkerRequest/);
  assert.match(source, /\/rebuild/);
  assert.match(source, /\/process-queue/);
});
