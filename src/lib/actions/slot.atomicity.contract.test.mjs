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
});

test("slot CASは修正後正本13列を比較し、保存時にversionを進める", () => {
  const expectedColumns = [
    "id",
    "event_id",
    "reserved_by_user_id",
    "x_user_id",
    "display_name",
    "slot_label",
    "start_time",
    "sort_order",
    "reservation_group_id",
    "video_id",
    "status",
    "updated_at",
    "version",
  ];
  const cas =
    source.match(/function expectedRowCondition[\s\S]*?function planSlotUpdate/)?.[0] ??
    "";
  for (const column of expectedColumns) {
    assert.match(cas, new RegExp(`slots\\.${column}`), column);
  }
  for (const retired of [
    "slot_kind",
    "priority_reclaim_video_id",
    "priority_reclaim_until",
  ]) {
    assert.doesNotMatch(cas, new RegExp(retired));
  }
  assert.match(source, /version: before\.version \+ 1/);
  assert.match(source, /before: snapshot\(update\.before\)/);
  assert.match(source, /after: snapshot\(update\.after\)/);
});

test("複数枠機能を維持し、業務上限はmax_slots_per_videoを正本にする", () => {
  assert.equal(MAX_ATOMIC_SLOT_ROWS, 3);
  assert.match(source, /event\.max_slots_per_video/);
  assert.doesNotMatch(source, /max_consecutive_slots_per_entry/);
  assert.match(source, /reservation_group_id/);
  assert.match(source, /buildReleaseGroupDecisions/);
  assert.match(source, /extendOwnSlotGroup/);
  assert.match(source, /mergeOwnSlotGroups/);
  assert.match(uiSource, /maxSlotsPerVideo/);
  assert.match(uiSource, /collapseReservationGroups/);
  assert.match(uiSource, /\{ length: atomicMaxConsecutiveSlots \}/);
});

test("3行更新+queue+完全auditはD1 Free query/bind上限内", () => {
  const budget = planD1AuditMutationBudget({
    mutationStatementCount: MAX_ATOMIC_SLOT_ROWS + 1,
    mutationAssertionCount: MAX_ATOMIC_SLOT_ROWS + 1,
    auditEntryCount: MAX_ATOMIC_SLOT_ROWS,
    distinctActorCount: 1,
  });
  const maxCasUpdateBinds = 8 + 13;
  const maxAuditChunkBinds = 21 * MAX_ATOMIC_SLOT_ROWS;

  assert.equal(budget.totalQueryCount, 22);
  assert.equal(budget.withinLimit, true);
  assert.ok(maxCasUpdateBinds <= 100);
  assert.ok(maxAuditChunkBinds <= 100);
});
