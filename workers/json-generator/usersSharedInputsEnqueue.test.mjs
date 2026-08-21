import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./usersSharedInputsEnqueue.ts", import.meta.url),
  "utf8",
);

test("users 共有JSONは legacy / v2 manifest / icon map / pickup の head で欠損を検知する", () => {
  assert.match(source, /users_index/);
  assert.match(source, /USERS_INDEX_OBJECT_KEY/);
  assert.match(source, /USERS_INDEX_V2_MANIFEST_OBJECT_KEY/);
  assert.match(source, /PUBLIC_X_ICON_MAP_OBJECT_KEY/);
  assert.match(source, /PICKUP_CREATORS_OBJECT_KEY/);
  assert.match(source, /ensureUsersSharedInputsOnR2/);
  assert.match(source, /env\.R2\.head/);
  assert.match(source, /target_id = 'global'/);
});
