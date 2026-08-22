import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./adminMembers.ts", import.meta.url), "utf8");

test("admin member save reuses the request-local D1 binding", () => {
  assert.doesNotMatch(source, /getDatabase\(\)/);
  assert.match(source, /const db = guard\.db/);
});
