import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./topRebuildEnqueue.ts", import.meta.url), "utf8");

test("enqueueTopSectionRebuild は任意 global target を共通 upsert で登録する", () => {
  assert.match(source, /export async function enqueueTopSectionRebuild/);
  assert.match(source, /enqueueStaticRebuildTargets\(\s*env,\s*globalTargets\(\[targetType\]\)/);
});
