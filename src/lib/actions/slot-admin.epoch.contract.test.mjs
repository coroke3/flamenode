import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./slot-admin.ts", import.meta.url), "utf8");

test("time-mode slot generation keeps Unix epoch timestamps valid", () => {
  assert.match(source, /if \(start == null \|\| end == null \|\| end <= start\)/);
  assert.doesNotMatch(source, /if \(!start \|\| !end \|\| end <= start\)/);
});
