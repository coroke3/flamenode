import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./slot-admin.ts", import.meta.url), "utf8");

test("slot-admin の全 mutation が canonical atomic helper を使う", () => {
  for (const name of [
    "generateSlotsBatch",
    "deleteAvailableSlots",
    "releaseSlot",
    "deleteSlot",
    "batchDeleteAvailableSlots",
    "batchReleaseReservedSlots",
    "batchUpdateSlotLabels",
  ]) {
    assert.match(source, new RegExp(`export async function ${name}`));
  }
  assert.equal((source.match(/mutateWithAudit\(/g) ?? []).length, 7);
  assert.equal((source.match(/buildEventQueueBatch\(/g) ?? []).length, 8);
  assert.doesNotMatch(source, /auditAction\(/);
});

test("slot-admin は caller 側の明示上限と stale CAS を持つ", () => {
  assert.match(source, /MAX_ATOMIC_SLOT_ROWS = 2/);
  assert.match(source, /NOT EXISTS \(/);
  assert.match(source, /versionedWhere\(/);
  assert.match(source, /expectedMutationChanges:/);
  assert.match(source, /postAuditStatements:/);
});
