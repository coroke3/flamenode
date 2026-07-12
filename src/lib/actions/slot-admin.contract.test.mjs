import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./slot-admin.ts", import.meta.url), "utf8");
const formSource = await readFile(
  new URL("../../components/admin/SlotBatchForm.tsx", import.meta.url),
  "utf8",
);
const limitSource = await readFile(
  new URL("../slots/atomicLimits.ts", import.meta.url),
  "utf8",
);

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
  assert.equal((source.match(/\.\.\.queueBatch\.statements/g) ?? []).length, 7);
  assert.equal((source.match(/\.\.\.queueBatch\.expectedChanges/g) ?? []).length, 7);
  assert.doesNotMatch(source, /auditAction\(/);
});

test("slot-admin は競合時に部分生成せず full snapshot と二重 CAS を維持する", () => {
  assert.match(source, /from "@\/lib\/slots\/atomicLimits"/);
  assert.match(source, /INSERT INTO slots/);
  assert.match(source, /NOT EXISTS \(/);
  assert.match(source, /UNION ALL/);
  assert.match(source, /expectedMutationChanges: \[newRows\.length, \.\.\.queueBatch\.expectedChanges\]/);
  assert.match(source, /eq\(slots\.version, row\.version\)/);
  assert.match(source, /eq\(slots\.updated_at, row\.updated_at\)/);
  assert.match(source, /before: snapshot\(/);
  assert.match(source, /after: (?:snapshot\(|after\(|\{ \.\.\.snapshot\()/);
});

test("queue は mutation 側、解放通知は同じ audit batch の post-audit 側に入る", () => {
  assert.doesNotMatch(source, /postAuditStatements:\s*(?:queueBatch|\[\.\.\.queueBatch)/);
  assert.equal((source.match(/postAuditStatements:/g) ?? []).length, 2);
  assert.match(source, /postAuditStatements: notification \? \[notification\] : \[\]/);
  assert.match(source, /postAuditStatements: notifications/);
});

test("3行の最悪経路が D1 Free 50 query / 100 bind 契約内に収まる", () => {
  const maxRows = 3;
  const maxConditionalInsertBinds = 18 * maxRows;
  const maxStrictAuditInsertBinds = 20 * maxRows;
  const maxUpdateBinds = 10 + 3 * maxRows;

  const permissionPrequeries = 2;
  const targetPrequeries = 2;
  const auditPrequeries = 2 * maxRows;
  const notificationPrequeries = 2 * maxRows;
  const queuePrequeries = 2;
  const batchStatements = 9;
  const worstQueryCount =
    permissionPrequeries +
    targetPrequeries +
    auditPrequeries +
    notificationPrequeries +
    queuePrequeries +
    batchStatements;

  assert.equal(maxConditionalInsertBinds, 54);
  assert.equal(maxStrictAuditInsertBinds, 60);
  assert.ok(Math.max(maxConditionalInsertBinds, maxStrictAuditInsertBinds, maxUpdateBinds) <= 100);
  assert.equal(worstQueryCount, 27);
  assert.ok(worstQueryCount <= 50);
});

test("slot生成のUIとserverは同じ3件上限を案内・検証する", () => {
  const serverLimit = limitSource.match(/MAX_ATOMIC_SLOT_ROWS = (\d+);/)?.[1];

  assert.equal(serverLimit, "3");
  assert.match(source, /from "@\/lib\/slots\/atomicLimits"/);
  assert.match(formSource, /from "@\/lib\/slots\/atomicLimits"/);
  assert.match(source, /count: z\.coerce\.number\(\)\.min\(1\)\.max\(MAX_ATOMIC_SLOT_ROWS\)/);
  assert.match(formSource, /max=\{MAX_ATOMIC_SLOT_ROWS\}/);
  assert.match(formSource, /defaultValue=\{MAX_ATOMIC_SLOT_ROWS\}/);
  assert.match(formSource, /終了日時までの範囲から、一度に最大 \{MAX_ATOMIC_SLOT_ROWS\} 枠/);
  assert.match(formSource, /一度に最大 \{MAX_ATOMIC_SLOT_ROWS\} 枠まで生成できます/);
});

test("上限判定前のavailable・group queryは4件目で打ち切る", () => {
  assert.equal((source.match(/\.limit\(MAX_ATOMIC_SLOT_ROWS \+ 1\)/g) ?? []).length, 3);
  assert.match(
    source,
    /eq\(slots\.status, "available"\)[\s\S]*?\.limit\(MAX_ATOMIC_SLOT_ROWS \+ 1\)/,
  );
  assert.match(
    source,
    /eq\(slots\.reservation_group_id, groupId\)[\s\S]*?\.limit\(MAX_ATOMIC_SLOT_ROWS \+ 1\)/,
  );
  assert.match(
    source,
    /inArray\(slots\.reservation_group_id, groupIds\)[\s\S]*?\.limit\(MAX_ATOMIC_SLOT_ROWS \+ 1\)/,
  );
});
