import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { planD1AuditMutationBudget } from "../audit/mutateBudget.ts";
import { MAX_ATOMIC_SLOT_ROWS } from "../slots/atomicLimits.ts";

const source = await readFile(new URL("./slot.ts", import.meta.url), "utf8");
const uiSource = await readFile(
  new URL("../../components/event/SlotGrid.tsx", import.meta.url),
  "utf8",
);

test("利用者slot操作は共通atomic plannerだけで書き込む", () => {
  for (const name of [
    "reserveSlot",
    "releaseOwnSlot",
    "extendOwnSlotGroup",
    "mergeOwnSlotGroups",
  ]) {
    assert.match(source, new RegExp(`export async function ${name}`));
  }
  assert.equal((source.match(/mutateWithAudit\(/g) ?? []).length, 1);
  assert.match(source, /buildStaticRebuildQueueBatch/);
  assert.match(source, /\.\.\.queue\.statements/);
  assert.match(source, /\.\.\.queue\.expectedChanges/);
  assert.doesNotMatch(source, /auditAction\(/);
  assert.doesNotMatch(source, /rollbackReservedSlots/);
  assert.doesNotMatch(source, /for \(const [^)]+\) \{\s*await db\s*\.update/);
});

test("slot CASはschemaの全16列とversionを比較し、保存時にversionを進める", () => {
  const expectedColumns = [
    "id",
    "event_id",
    "reserved_by_user_id",
    "x_user_id",
    "display_name",
    "slot_kind",
    "slot_label",
    "start_time",
    "sort_order",
    "reservation_group_id",
    "priority_reclaim_video_id",
    "priority_reclaim_until",
    "video_id",
    "status",
    "updated_at",
    "version",
  ];
  const cas = source.match(
    /function expectedRowCondition[\s\S]*?\n}\n\nfunction planSlotUpdate/,
  )?.[0] ?? "";
  for (const column of expectedColumns) {
    assert.match(cas, new RegExp(`slots\\.${column}`), column);
  }
  assert.match(source, /version: before\.version \+ 1/);
  assert.match(source, /before: snapshot\(update\.before\)/);
  assert.match(source, /after: snapshot\(update\.after\)/);
});

test("groupとevent隣接探索は4件で打ち切り、利用者とUIの上限は3", () => {
  assert.equal(MAX_ATOMIC_SLOT_ROWS, 3);
  assert.equal(
    (source.match(/\.limit\(MAX_ATOMIC_SLOT_ROWS \+ 1\)/g) ?? []).length,
    5,
  );
  assert.match(
    source,
    /consecutive_count:[\s\S]*?\.max\(MAX_ATOMIC_SLOT_ROWS\)/,
  );
  assert.match(uiSource, /from "@\/lib\/slots\/atomicLimits"/);
  assert.match(uiSource, /const atomicMaxConsecutiveSlots = Math\.min\(/);
  assert.match(uiSource, /\{ length: atomicMaxConsecutiveSlots \}/);
});

test("3行更新+queue+完全auditはD1 Free query/bind上限内", () => {
  const budget = planD1AuditMutationBudget({
    mutationStatementCount: MAX_ATOMIC_SLOT_ROWS + 1,
    mutationAssertionCount: MAX_ATOMIC_SLOT_ROWS + 1,
    auditEntryCount: MAX_ATOMIC_SLOT_ROWS,
    distinctActorCount: 1,
  });
  const maxCasUpdateBinds = 8 + 16;
  const maxAuditChunkBinds = 21 * MAX_ATOMIC_SLOT_ROWS;

  assert.equal(budget.totalQueryCount, 22);
  assert.equal(budget.withinLimit, true);
  assert.ok(maxCasUpdateBinds <= 100);
  assert.ok(maxAuditChunkBinds <= 100);
});
