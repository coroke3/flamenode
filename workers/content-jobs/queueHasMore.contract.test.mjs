import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("../json-generator/queue.ts", import.meta.url), "utf8");

test("processStaticRebuildQueue は LIMIT+1 で hasMore を返す", () => {
  assert.match(source, /const processLimit = queueLimitForMode\(mode\)/);
  assert.match(source, /const fetchLimit = processLimit \+ 1/);
  assert.match(source, /const hasMore = fetchedRows\.length > processLimit/);
  assert.match(source, /hasMore/);
});
