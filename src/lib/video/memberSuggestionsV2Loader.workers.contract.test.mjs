import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./memberSuggestionsV2Loader.ts", import.meta.url),
  "utf8",
);

test("Member Suggestions V2 isolate cacheはpure JSONだけを保持する", () => {
  const cachedTypeStart = source.indexOf("type CachedJson = {");
  const cachedTypeEnd = source.indexOf("};", cachedTypeStart);
  assert.ok(cachedTypeStart >= 0 && cachedTypeEnd > cachedTypeStart);
  const cachedType = source.slice(cachedTypeStart, cachedTypeEnd);
  assert.doesNotMatch(cachedType, /bucket:/);
  assert.doesNotMatch(source, /cached\.bucket/);
  assert.doesNotMatch(source, /jsonCache\.set\([^\n]*\{\s*bucket,/);
  assert.match(source, /jsonCache\.set\(keyValue, \{ value, fetchedAt: nowSec \}\)/);
});
