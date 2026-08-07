import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { planD1AuditMutationBudget } from "../audit/mutateBudget.ts";
import { MAX_ATOMIC_SLOT_ROWS } from "../slots/atomicLimits.ts";
import { MAX_SLOTS_PER_VIDEO } from "../slots/limits.ts";

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
  const commit =
    source.match(/async function commitSlotMutationPlan[\s\S]*?async function loadSlot/)?.[0] ??
    "";
  assert.match(commit, /const queue = await buildSlotChangeQueueBatch/);
  assert.match(
    commit,
    /mutationStatements:\s*\[[\s\S]*?\.\.\.mutationStatements,[\s\S]*?\.\.\.queue\.statements,[\s\S]*?\.\.\.extra,/,
  );
  assert.match(
    commit,
    /expectedMutationChanges:\s*\[[\s\S]*?\.\.\.expectedMutationChanges,[\s\S]*?\.\.\.queue\.expectedChanges,[\s\S]*?\.\.\.extra\.map\(\(\) => null\),/,
  );
  assert.match(commit, /audits,/);
  assert.match(commit, /notificationWakeSource:\s*wakeNotification/);
  assert.match(
    commit,
    /staticRebuildWakeSource:\s*queue\.statements\.length > 0 \? "web" : undefined/,
  );
  assert.match(source, /versionedSlotWhere/);
  assert.match(source, /buildOpsChannelWebhookStatement/);
  assert.match(source, /extraStatements\.push\(channelNotification\.statement\)/);
  assert.match(source, /extraStatements,[\s\S]*?notificationWakeSource,/);
  assert.doesNotMatch(source, /auditAction\(/);
  assert.doesNotMatch(source, /rollbackReservedSlots/);
});

test("slot CASはversionedSlotWhereでid+version+updated_atを比較する", () => {
  assert.match(source, /from "@\/lib\/slots\/versionedPredicate"/);
  assert.match(source, /versionedSlotWhere\(/);
  assert.match(source, /version: sql`\$\{slots\.version\} \+ 1`/);
  assert.match(source, /before: snapshot\(before\)/);
  assert.match(source, /after: snapshot\(applySlotPatch\(before, mutation\.patch, now\)\)/);
  assert.doesNotMatch(source, /function expectedRowCondition/);
  assert.doesNotMatch(source, /function planSlotUpdate/);
});

test("複数枠機能を維持し、業務上限はmax_slots_per_videoを正本にする", () => {
  assert.equal(MAX_ATOMIC_SLOT_ROWS, 3);
  assert.equal(MAX_SLOTS_PER_VIDEO, 20);
  assert.match(source, /normalizeMaxSlotsPerVideo/);
  assert.match(source, /eventDomainLimit/);
  assert.doesNotMatch(source, /max_consecutive_slots_per_entry/);
  assert.match(source, /reservation_group_id/);
  assert.match(source, /buildReleaseGroupDecisions/);
  assert.match(source, /extendOwnSlotGroup/);
  assert.match(source, /mergeOwnSlotGroups/);
  assert.match(uiSource, /maxSlotsPerVideo/);
  assert.match(uiSource, /annotateReservationGroups/);
  assert.doesNotMatch(uiSource, /collapseReservationGroups/);
});

test("mergeOwnSlotGroupsはx_user_id混在を拒否しidentityでgapへtargetXIdを書く", () => {
  const mergeBlock =
    source.match(/export async function mergeOwnSlotGroups[\s\S]*?(?=export async function|$)/)?.[0] ??
    "";
  assert.match(mergeBlock, /left\.x_user_id !== right\.x_user_id/);
  assert.match(mergeBlock, /resolveBoundedGroupIdentity/);
  assert.match(mergeBlock, /adoptNullRowPatch/);
  assert.match(mergeBlock, /x_user_id:\s*targetXId/);
});

test("extendOwnSlotGroupはidentityでx_user_idを継承し別Xへの書換えを拒否する", () => {
  const extendBlock =
    source.match(
      /export async function extendOwnSlotGroup[\s\S]*?(?=export async function mergeOwnSlotGroups)/,
    )?.[0] ?? "";
  assert.match(extendBlock, /groupXUserId !== slotXUserId/);
  assert.match(extendBlock, /identity\.targetXId/);
  assert.match(extendBlock, /adoptNullRowPatch/);
  assert.match(extendBlock, /x_user_id:\s*targetXId/);
});

test("20枠reserveは1 bulk mutation+queue+通知+完全auditがD1上限内", () => {
  const slotRows = 20;
  const mutationStatementCount = 1 + 1 + 1;
  const mutationAssertionCount = 1 + 1 + 1;
  const budget = planD1AuditMutationBudget({
    mutationStatementCount,
    mutationAssertionCount,
    auditEntryCount: slotRows,
    distinctActorCount: 1,
  });
  const bulkCasBinds = 8 + slotRows * 3;
  const maxAuditChunkBinds = 21 * 4;

  assert.equal(budget.mutationStatementCount, 3);
  assert.equal(budget.totalQueryCount, 28);
  assert.equal(budget.withinLimit, true);
  assert.ok(bulkCasBinds <= 100);
  assert.ok(maxAuditChunkBinds <= 100);
});

test("3行更新+queue+通知+完全auditはD1 Free query/bind上限内", () => {
  const budget = planD1AuditMutationBudget({
    mutationStatementCount: 3,
    mutationAssertionCount: 3,
    auditEntryCount: MAX_ATOMIC_SLOT_ROWS,
    distinctActorCount: 1,
  });
  const maxCasUpdateBinds = 8 + 3 * 3;
  const maxAuditChunkBinds = 21 * MAX_ATOMIC_SLOT_ROWS;

  assert.equal(budget.totalQueryCount, 20);
  assert.equal(budget.withinLimit, true);
  assert.ok(maxCasUpdateBinds <= 100);
  assert.ok(maxAuditChunkBinds <= 100);
});

test("利用者枠操作は slotIdentityCore で Active 一致を判定し authUserControlsXId を使わない", () => {
  assert.doesNotMatch(source, /authUserControlsXId/);
  assert.doesNotMatch(source, /ownsSlot/);
  assert.doesNotMatch(source, /xUserAccountLinks/);
  assert.match(source, /resolveSlotViewerRelation/);
  assert.match(source, /canActAsSlotActor/);
  assert.match(source, /resolveSlotGroupIdentity/);
  assert.match(source, /loadBoundedGroupStructure/);
  assert.match(source, /resolveBoundedGroupIdentity/);
  assert.match(
    source,
    /この枠は現在とは別の活動名義で確保されています。Active X IDを切り替えてから操作してください。/,
  );
  assert.match(
    source,
    /relation === "account_other"[\s\S]*?SLOT_ACCOUNT_OTHER_MESSAGE/,
  );
  assert.match(source, /adoptNullRowPatch/);
});
