import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const web = fs.readFileSync("src/lib/publicData/publicJsonCacheTtl.ts", "utf8");
const worker = fs.readFileSync("workers/shared/staticR2CacheControl.ts", "utf8");

test("top slot stats stay fresh without shortening the whole top artifact", () => {
  for (const source of [web, worker]) {
    assert.match(source, /top: 600/);
    assert.match(source, /topSlotStats: 30/);
    assert.match(source, /trending: 300/);
  }
});
