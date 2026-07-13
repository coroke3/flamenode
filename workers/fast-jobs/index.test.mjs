import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
const sharedSource = await readFile(
  new URL("../shared/createCronWorker.ts", import.meta.url),
  "utf8",
);

test("fast-jobs health は共通Cron Workerからserviceとcommitを返す", () => {
  assert.match(source, /createCronWorker/);
  assert.match(source, /service:\s*"fast-jobs"/);
  assert.match(source, /BUILD_COMMIT_SHA/);
  assert.match(sharedSource, /pathname\s*===\s*[\r\n\s]*"\/health"/);
  assert.match(sharedSource, /commit:/);
  assert.match(sharedSource, /env\.BUILD_COMMIT_SHA/);
});
