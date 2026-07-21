import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { planD1AuditMutationBudget } from "../audit/mutateBudget.ts";

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const action = read("./chapter.ts");
const limits = read("./chapterLimits.ts");
const composer = read("../../components/video/ChapterComposer.tsx");

function actionSection(startMarker, endMarker) {
  const start = action.indexOf(startMarker);
  const end = action.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `${startMarker} が見つかりません`);
  assert.notEqual(end, -1, `${endMarker} が見つかりません`);
  return action.slice(start, end);
}

const createAction = actionSection(
  "export async function createChapter",
  "export async function updateChapter",
);
const updateAction = actionSection(
  "export async function updateChapter",
  "export async function deleteChapter",
);
const deleteAction = actionSection(
  "export async function deleteChapter",
  "export async function createChaptersBulk",
);

test("全チャプターwriteは各1回のmutateWithAuditでqueueまで保存する", () => {
  assert.equal((action.match(/await mutateWithAudit\(db,/g) ?? []).length, 4);
  assert.equal((action.match(/await buildStaticRebuildQueueBatch\(db,/g) ?? []).length, 4);
  assert.doesNotMatch(action, /enqueueNotification\(/);
  assert.match(action, /buildNotificationOutboxStatement/);
  assert.match(action, /mutationStatements\.push\(notification\)/);
  assert.match(action, /mutationStatements\.push\(\.\.\.queue\.statements\)/);
});

test("更新と削除は全scalar snapshot CASと完全な監査snapshotを使う", () => {
  assert.equal(
    (action.match(/expectedRowCondition\(\{ expectedCurrent: existing \}\)/g) ?? []).length,
    2,
  );
  assert.match(
    updateAction,
    /expectedMutationChanges:\s*\[\s*1,\s*\.\.\.queue\.expectedChanges\s*\]/,
  );
  assert.match(
    deleteAction,
    /expectedMutationChanges:\s*\[\s*1,\s*\.\.\.queue\.expectedChanges\s*\]/,
  );
  assert.match(
    updateAction,
    /operation:\s*"UPDATE",[\s\S]*?before:\s*\{\s*\.\.\.existing\s*\},[\s\S]*?after:\s*\{\s*\.\.\.after\s*\}/,
  );
  assert.match(
    deleteAction,
    /operation:\s*"DELETE",[\s\S]*?before:\s*\{\s*\.\.\.existing\s*\},[\s\S]*?after:\s*null/,
  );
  assert.match(
    createAction,
    /operation:\s*"CREATE",[\s\S]*?before:\s*null,[\s\S]*?after:\s*\{\s*\.\.\.after\s*\}/,
  );
});

test("CSV上限はサーバーとUIで共通化され、書込み前に拒否する", () => {
  assert.match(limits, /MAX_ATOMIC_CHAPTER_BULK_ROWS = 8/);
  assert.match(action, /rowsRaw\.length > MAX_ATOMIC_CHAPTER_BULK_ROWS/);
  assert.match(composer, /parseChapterBulkCsv\(bulkCsv\)\.length/);
  assert.match(composer, /dataRowCount > MAX_ATOMIC_CHAPTER_BULK_ROWS/);
  assert.match(composer, /最大 \{MAX_ATOMIC_CHAPTER_BULK_ROWS\} 行/);
  assert.ok(
    action.indexOf("rowsRaw.length > MAX_ATOMIC_CHAPTER_BULK_ROWS") <
      action.indexOf("const pendingRows"),
  );
  assert.match(action, /VALUES \$\{sql\.join\(pendingRows\.map/);
  assert.match(action, /expectedMutationChanges: \[inserted, \.\.\.queue\.expectedChanges\]/);
});

test("D1 bind/query予算はbulk上限8でも制約内に収まる", () => {
  // chapter INSERT は全11列を明示するため、8行で88 bind。
  assert.ok(8 * 11 < 100);
  const createBudget = planD1AuditMutationBudget({
    mutationStatementCount: 3,
    mutationAssertionCount: 3,
    auditEntryCount: 1,
    distinctActorCount: 1,
  });
  const bulkBudget = planD1AuditMutationBudget({
    mutationStatementCount: 2,
    mutationAssertionCount: 2,
    auditEntryCount: 8,
    distinctActorCount: 1,
  });
  assert.deepEqual(
    { total: createBudget.totalQueryCount, withinLimit: createBudget.withinLimit },
    { total: 20, withinLimit: true },
  );
  assert.deepEqual(
    { total: bulkBudget.totalQueryCount, withinLimit: bulkBudget.withinLimit },
    { total: 20, withinLimit: true },
  );
});
