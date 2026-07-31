import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./topRebuildEnqueue.ts", import.meta.url), "utf8");

test("enqueueTopRebuild は top:global を pending へ登録する", () => {
  assert.match(source, /export async function enqueueTopRebuild/);
  assert.match(source, /target_type = 'top'/);
  assert.match(source, /target_id = 'global'/);
  assert.match(source, /INSERT OR IGNORE INTO static_rebuild_queue/);
});
