import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const enqueue = await readFile(new URL("./enqueue.ts", import.meta.url), "utf8");
const columns = await readFile(
  new URL("./activeLookupColumns.ts", import.meta.url),
  "utf8",
);

test("active lookup は必要列だけを select する", () => {
  assert.match(columns, /staticRebuildActiveLookupSelect/);
  assert.match(enqueue, /select\(staticRebuildActiveLookupSelect\)/);
  assert.doesNotMatch(
    enqueue,
    /inArray\(staticRebuildQueue\.status, \["pending", "processing"\]\)[\s\S]{0,120}\.select\(\)/,
  );
});

test("active lookup select に attempt_count や error を含めない", () => {
  assert.doesNotMatch(columns, /attempt_count/);
  assert.doesNotMatch(columns, /error:/);
  assert.doesNotMatch(columns, /created_at/);
  assert.doesNotMatch(columns, /processed_at/);
});
