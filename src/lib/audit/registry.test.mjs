import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const registrySource = await readFile(new URL("./registry.ts", import.meta.url), "utf8");
const adaptersSource = await readFile(new URL("./adapters.ts", import.meta.url), "utf8");

test("restore registry は主要テーブルを登録する", () => {
  assert.match(adaptersSource, /export const RESTORE_ADAPTERS/);
  assert.match(registrySource, /tableName: "event_staff"/);
  assert.match(registrySource, /tableName: "events"/);
  assert.match(registrySource, /permission_preset/);
  assert.match(registrySource, /supportedStrategies: \[\s*"delete_created"/);
});

test("未登録テーブルは getRestoreRegistration で null", () => {
  assert.match(registrySource, /export function getRestoreRegistration/);
  assert.match(registrySource, /return getRestoreRegistration\(tableName\) !== null/);
});
