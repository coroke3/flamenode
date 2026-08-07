import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./topRebuildEnqueue.ts", import.meta.url), "utf8");

test("enqueueTopSectionRebuild は任意 global target を pending へ登録する", () => {
  assert.match(source, /export async function enqueueTopSectionRebuild/);
  assert.match(source, /WHERE target_type = \?/);
  assert.match(source, /target_id = 'global'/);
  assert.match(source, /INSERT OR IGNORE INTO static_rebuild_queue/);
});

test("enqueueTopRebuild は top composer 向けラッパー", () => {
  assert.match(source, /enqueueTopSectionRebuild\(env, "top"/);
});
