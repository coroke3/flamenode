import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

test("about-stats Cache APIはqueryによるcache-bypassを許さずwaitUntilで保存する", () => {
  assert.match(source, /\/api\/public\/about-stats/);
  assert.doesNotMatch(source, /new Request\(req\.url/);
  assert.match(source, /context\.ctx\.waitUntil\(write\)/);
  assert.match(source, /await cachePublicResponse\(cache, cacheKey, response\.clone\(\)\)/);
});
