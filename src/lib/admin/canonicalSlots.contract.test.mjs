import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [integrityChecks, healthChecks] = await Promise.all([
  readFile(new URL("./integrityChecks.ts", import.meta.url), "utf8"),
  readFile(new URL("./healthChecks.ts", import.meta.url), "utf8"),
]);

test("管理ヘルスチェックは廃止済みのslots.slot_kindを参照しない", () => {
  assert.doesNotMatch(integrityChecks, /\bslot_kind\b/);
  assert.doesNotMatch(healthChecks, /\bslot_kind\b/);
  assert.match(integrityChecks, /start_time IS NOT NULL\s+AND EXISTS/);
});
