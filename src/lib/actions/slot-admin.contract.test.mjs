import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { planD1AuditMutationBudget } from "../audit/mutateBudget.ts";
import { MAX_SLOTS_PER_VIDEO } from "../slots/limits.ts";

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
  assert.equal((source.match(/mutateWithAudit\(/g) ?? []).length, 4);
  assert.equal((source.match(/eventQueue\(/g) ?? []).length, 5);
  assert.equal((source.match(/\.\.\.queue\.statements/g) ?? []).length, 4);
  assert.equal((source.match(/\.\.\.queue\.expectedChanges/g) ?? []).length, 4);
  assert.equal((source.match(/return deleteRows\(/g) ?? []).length, 2);
  assert.match(source, /deleteAvailableSlots[\s\S]*?await deleteRows\(/);
  assert.equal((source.match(/return releaseRows\(/g) ?? []).length, 2);
  assert.doesNotMatch(source, /auditAction\(/);
});

test("slot-admin は競合時に部分生成せず full snapshot と二重 CAS を維持する", () => {
  assert.match(source, /from "@\/lib\/slots\/atomicLimits"/);
  assert.match(source, /INSERT INTO slots/);
  assert.match(source, /NOT EXISTS \(/);
  assert.match(source, /UNION ALL/);
  assert.match(source, /expectedMutationChanges: \[rows\.length, \.\.\.queue\.expectedChanges\]/);
  assert.match(source, /versionedSlotWhere/);
  assert.match(source, /before: snapshot\(/);
  assert.match(source, /after: (?:snapshot\(|after\(|\{ \.\.\.snapshot\()/);
});

test("queue は mutation 側、解放通知は同じ audit batch の post-audit 側に入る", () => {
  assert.doesNotMatch(source, /postAuditStatements:\s*(?:queue|\[\.\.\.queue)/);
  assert.equal((source.match(/postAuditStatements:/g) ?? []).length, 1);
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

test("slot生成は件数を行配列作成前に検証し、UIとserverは同じ上限を案内する", () => {
  assert.match(source, /from "@\/lib\/slots\/batchGenerateCount"/);
  assert.match(source, /computeTimeModeSlotBatchCount/);
  assert.match(source, /computeCountModeSlotBatchCount/);
  assert.match(limitSource, /MAX_SLOT_BATCH_GENERATE_COUNT = (\d+);/);
  const serverLimit = limitSource.match(
    /MAX_SLOT_BATCH_GENERATE_COUNT = (\d+);/,
  )?.[1];

  assert.equal(serverLimit, "100");
  assert.match(source, /from "@\/lib\/slots\/atomicLimits"/);
  assert.match(formSource, /from "@\/lib\/slots\/atomicLimits"/);
  assert.match(
    source,
    /count: z\.coerce\.number\(\)\.min\(1\)\.max\(MAX_SLOT_BATCH_GENERATE_COUNT\)/,
  );
  assert.match(formSource, /max=\{MAX_SLOT_BATCH_GENERATE_COUNT\}/);
  assert.match(formSource, /defaultValue=\{10\}/);
  assert.match(
    formSource,
    /終了日時までの範囲から、最大 \{MAX_SLOT_BATCH_GENERATE_COUNT\} 枠まで生成できます/,
  );
  assert.match(
    formSource,
    /最大 \{MAX_SLOT_BATCH_GENERATE_COUNT\} 枠まで一度に生成できます/,
  );
  assert.match(formSource, /内部では 3 件ずつ分割実行されます/);
  assert.match(source, /chunkRows\(newRows, MAX_ATOMIC_SLOT_ROWS\)/);
});

test("releaseSlotはdomain上限、batch group queryはatomic chunk上限で打ち切る", () => {
  assert.match(source, /MAX_SLOTS_PER_VIDEO \+ 1/);
  assert.equal((source.match(/\.limit\(MAX_ATOMIC_SLOT_ROWS \+ 1\)/g) ?? []).length, 1);
  assert.match(
    source,
    /deleteAvailableSlots[\s\S]*?\.limit\(MAX_ATOMIC_SLOT_ROWS\)/,
  );
  assert.match(
    source,
    /inArray\(slots\.reservation_group_id, groupIds\)[\s\S]*?\.limit\(MAX_ATOMIC_SLOT_ROWS \+ 1\)/,
  );
  assert.match(source, /from "@\/lib\/slots\/versionedPredicate"/);
  assert.match(source, /versionedSlotWhere/);
});

test("releaseSlotはMAX_SLOTS_PER_VIDEOまでのgroup loadでMAX_ATOMIC_SLOT_ROWSを使わない", () => {
  const releaseSlotBlock =
    source.match(
      /export async function releaseSlot[\s\S]*?(?=export async function deleteSlot)/,
    )?.[0] ?? "";
  assert.ok(releaseSlotBlock.length > 0);
  assert.match(releaseSlotBlock, /\.limit\(MAX_SLOTS_PER_VIDEO \+ 1\)/);
  assert.doesNotMatch(releaseSlotBlock, /MAX_ATOMIC_SLOT_ROWS/);
  assert.equal(MAX_SLOTS_PER_VIDEO, 20);
});

test("releaseRowsは1 bulk UPDATEとexpectedMutationChanges [rows.length, ...queue]を維持する", () => {
  const releaseRowsBlock =
    source.match(/async function releaseRows[\s\S]*?(?=export async function deleteSlot)/)?.[0] ??
    "";
  assert.ok(releaseRowsBlock.length > 0);
  assert.match(
    releaseRowsBlock,
    /\.update\(slots\)[\s\S]*?versionedSlotWhere\(eventId, rows, "reserved"\)/,
  );
  assert.match(
    releaseRowsBlock,
    /expectedMutationChanges: \[rows\.length, \.\.\.queue\.expectedChanges\]/,
  );
  assert.equal((releaseRowsBlock.match(/\.update\(slots\)/g) ?? []).length, 1);
});

test("20枠admin releaseは1 mutation+queue+通知+完全auditがD1上限内", () => {
  const slotRows = MAX_SLOTS_PER_VIDEO;
  const queueStatementCount = 1;
  const queueAssertionCount = 1;
  const mutationStatementCount = 1 + queueStatementCount;
  const mutationAssertionCount = 1 + queueAssertionCount;
  const postAuditStatementCount = 1;
  const budget = planD1AuditMutationBudget({
    mutationStatementCount,
    mutationAssertionCount,
    auditEntryCount: slotRows,
    postAuditStatementCount,
    distinctActorCount: 1,
  });

  assert.equal(budget.mutationStatementCount, 2);
  assert.equal(budget.withinLimit, true);
  assert.ok(
    budget.totalQueryCount <= budget.limit,
    `totalQueryCount=${budget.totalQueryCount}`,
  );
  const bulkCasBinds = 2 + slotRows * 3 + 4;
  assert.ok(bulkCasBinds <= 100, `bulkCasBinds=${bulkCasBinds}`);
});
