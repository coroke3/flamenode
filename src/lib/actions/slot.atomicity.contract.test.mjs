import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { planD1AuditMutationBudget } from "../audit/mutateBudget.ts";
import { MAX_ATOMIC_SLOT_ROWS } from "../slots/atomicLimits.ts";
import { MAX_SLOTS_PER_VIDEO } from "../slots/limits.ts";

const source = await readFile(new URL("./slot.ts", import.meta.url), "utf8");
const releasePlannerSource = await readFile(
  new URL("../../../packages/domain/src/slots/releaseMutations.ts", import.meta.url),
  "utf8",
);
const reservePlannerSource = await readFile(
  new URL("../../../packages/domain/src/slots/reserveMutations.ts", import.meta.url),
  "utf8",
);
const atomicPlannerSource = await readFile(
  new URL("../../../packages/domain/src/slots/atomicAuditPlan.ts", import.meta.url),
  "utf8",
);
const atomicBridgeSource = await readFile(
  new URL("../slots/slotAtomicAuditPlan.ts", import.meta.url),
  "utf8",
);
const reserveBridgeSource = await readFile(
  new URL("../slots/slotReserveMutations.ts", import.meta.url),
  "utf8",
);
const releaseBridgeSource = await readFile(
  new URL("../slots/slotReleaseMutations.ts", import.meta.url),
  "utf8",
);
const coreSource = await readFile(
  new URL("../../../packages/server-core/src/slots/commitSlotMutationPlan.ts", import.meta.url),
  "utf8",
);
const uiSource = await readFile(
  new URL("../../components/event/SlotGrid.tsx", import.meta.url),
  "utf8",
);

test("利用者slot操作は共有server-core経由でのみ原子的に書き込む", () => {
  for (const name of [
    "reserveSlot", "releaseOwnSlot", "extendOwnSlotGroup", "mergeOwnSlotGroups",
  ]) assert.match(source, new RegExp(`export async function ${name}`));
  assert.equal((source.match(/mutateWithAudit\(/g) ?? []).length, 0);
  assert.equal((coreSource.match(/mutateWithAudit\(/g) ?? []).length, 1);
  assert.match(source, /await commitSlotMutationPlanCore\(\{ \.\.\.args, loadWakeHost: loadNextSlotQueueWakeHost \}\)/);
  assert.match(source, /import\("@\/lib\/serverCore\/nextPorts"\)/);
  assert.doesNotMatch(coreSource, /next\/|nextPorts|getCloudflareContext|process\.env/);
  const commit=coreSource;
  assert.match(commit, /const queue = await buildSlotChangeQueueBatch/);
  assert.match(commit, /mutationStatements:\s*\[[\s\S]*?\.\.\.mutationStatements,[\s\S]*?\.\.\.queue\.statements,[\s\S]*?\.\.\.extra,/);
  assert.match(commit, /expectedMutationChanges:\s*\[[\s\S]*?\.\.\.expectedMutationChanges,[\s\S]*?\.\.\.queue\.expectedChanges,[\s\S]*?\.\.\.extra\.map\(\(\) => null\),/);
  assert.match(commit, /audits,/);
  assert.match(commit, /notificationWakeSource:\s*wakeNotification/);
  assert.match(commit, /staticRebuildWakeSource:\s*queue\.statements\.length > 0 \? "web" : undefined/);
  assert.match(commit, /mutateWithAudit\(args\.db,[\s\S]*?args\.loadWakeHost\)/);
  assert.match(source, /buildOpsChannelWebhookStatement/);
  assert.match(source, /extraStatements\.push\(channelNotification\.statement\)/);
  assert.match(source, /extraStatements,[\s\S]*?notificationWakeSource,/);
  assert.doesNotMatch(source, /auditAction\(/);
  assert.doesNotMatch(source, /rollbackReservedSlots/);
});

test("slot CASは共通executorのversionedSlotWhereでid+version+updated_at+snapshotを比較する", () => {
  assert.match(source, /@flamenode\/server-core\/slots\/commitSlotMutationPlan/);
  assert.match(coreSource, /from "\.\/versionedPredicate\.ts"/);
  assert.match(coreSource, /versionedSlotWhere\(/);
  assert.match(coreSource, /version: sql`\$\{slots\.version\} \+ 1`/);
  assert.match(coreSource, /const plan = buildSlotAtomicAuditPlan\(args\.mutations, now\)/);
  assert.match(coreSource, /before: delta\.before/);
  assert.match(coreSource, /after: delta\.after/);
  assert.match(atomicPlannerSource, /before: \{ \.\.\.row \}/);
  assert.match(atomicPlannerSource, /version: row\.version \+ 1/);
  assert.match(atomicBridgeSource, /@flamenode\/domain\/slots\/atomicAuditPlan/);
  assert.doesNotMatch(coreSource, /function expectedRowCondition/);
  assert.doesNotMatch(coreSource, /function planSlotUpdate/);
});

test("複数枠機能を維持し、業務上限はmax_slots_per_videoを正本にする", () => {
  assert.equal(MAX_ATOMIC_SLOT_ROWS, 3);
  assert.equal(MAX_SLOTS_PER_VIDEO, 20);
  assert.match(source, /normalizeMaxSlotsPerVideo/);
  assert.match(source, /eventDomainLimit/);
  assert.doesNotMatch(source, /max_consecutive_slots_per_entry/);
  assert.match(source, /reservation_group_id/);
  // The D1/authorization adapter now delegates pure group planning to domain.
  assert.ok(source.includes('return buildSlotReleaseMutationPlan(groupRows, anchorId, generateId("sgrp"))'));
  assert.match(releasePlannerSource, /buildReleaseGroupDecisions/);
  assert.ok(releaseBridgeSource.includes("@flamenode/domain/slots/releaseMutations"));
  assert.match(source, /extendOwnSlotGroup/);
  assert.match(source, /mergeOwnSlotGroups/);
  assert.match(uiSource, /maxSlotsPerVideo/);
  assert.match(uiSource, /annotateReservationGroups/);
  assert.doesNotMatch(uiSource, /collapseReservationGroups/);
});

test("releaseはreserved_x_id_snapshotをクリアする", () => {
  assert.match(releasePlannerSource, /reserved_x_id_snapshot: null/);
  assert.match(releasePlannerSource, /status: "available"/);
  assert.match(source, /return buildSlotReleaseMutationPlan/);
});

test("reserveSlotはresolveReservationXIdentityを使う", () => {
  assert.match(source, /resolveReservationXIdentity/);
  assert.match(source, /const reserveMutations = buildSlotReserveMutationPlan/);
  assert.match(source, /mutations: reserveMutations/);
  assert.match(reservePlannerSource, /reserved_x_id_snapshot: input\.identity\.snapshotXId/);
  assert.match(reserveBridgeSource, /@flamenode\/domain\/slots\/reserveMutations/);
});

test("mergeOwnSlotGroupsはsnapshot混在を拒否する", () => {
  const mergeBlock =
    source.match(/export async function mergeOwnSlotGroups[\s\S]*?(?=export async function|$)/)?.[0] ??
    "";
  assert.match(mergeBlock, /left\.reserved_x_id_snapshot !== right\.reserved_x_id_snapshot/);
});

test("extendOwnSlotGroupは既存groupのsnapshotを継承する", () => {
  const extendBlock =
    source.match(
      /export async function extendOwnSlotGroup[\s\S]*?(?=export async function mergeOwnSlotGroups)/,
    )?.[0] ?? "";
  assert.match(extendBlock, /snapshotXId: groupSnapshotXId/);
  assert.match(extendBlock, /const candidateMutations = buildSlotReserveMutationPlan/);
  assert.match(extendBlock, /\.\.\.candidateMutations/);
  assert.match(reservePlannerSource, /reserved_x_id_snapshot: input\.identity\.snapshotXId/);
});

test("mergeOwnSlotGroupsはx_user_id混在を拒否しidentityでgapへtargetXIdを書く", () => {
  const mergeBlock =
    source.match(/export async function mergeOwnSlotGroups[\s\S]*?(?=export async function|$)/)?.[0] ??
    "";
  assert.match(mergeBlock, /left\.x_user_id !== right\.x_user_id/);
  assert.match(mergeBlock, /resolveBoundedGroupIdentity/);
  assert.match(mergeBlock, /buildRegroupMutations\(\s*reservedRows/);
  assert.match(mergeBlock, /canonicalXUserId:\s*targetXId/);
  assert.match(mergeBlock, /snapshotXId:\s*inheritedSnapshot/);
  assert.match(mergeBlock, /\.\.\.gapMutations/);
  assert.match(reservePlannerSource, /x_user_id: input\.identity\.canonicalXUserId/);
});

test("extendOwnSlotGroupはidentityでx_user_idを継承し別Xへの書換えを拒否する", () => {
  const extendBlock =
    source.match(
      /export async function extendOwnSlotGroup[\s\S]*?(?=export async function mergeOwnSlotGroups)/,
    )?.[0] ?? "";
  assert.match(extendBlock, /groupXUserId !== slotXUserId/);
  assert.match(extendBlock, /identity\.targetXId/);
  assert.match(extendBlock, /buildRegroupMutations\(\s*groupRows/);
  assert.match(extendBlock, /canonicalXUserId:\s*targetXId/);
  assert.match(extendBlock, /\.\.\.candidateMutations/);
  assert.match(reservePlannerSource, /x_user_id: input\.identity\.canonicalXUserId/);
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
  const bulkCasBinds = 8 + slotRows * 4;
  const maxAuditChunkBinds = 21 * 4;

  assert.equal(budget.mutationStatementCount, 3);
  assert.equal(budget.totalQueryCount, 36);
  assert.equal(budget.withinLimit, true);
  assert.ok(bulkCasBinds <= 100);
  assert.ok(maxAuditChunkBinds <= 100);
});

test("3行更新+queue+完全auditはD1 Free query/bind上限内", () => {
  const budget = planD1AuditMutationBudget({
    mutationStatementCount: 3,
    mutationAssertionCount: 3,
    auditEntryCount: MAX_ATOMIC_SLOT_ROWS,
    distinctActorCount: 1,
  });
  const maxCasUpdateBinds = 8 + 3 * 3;
  const maxAuditChunkBinds = 21 * MAX_ATOMIC_SLOT_ROWS;

  assert.equal(budget.totalQueryCount, 28);
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
  assert.match(source, /assertBoundedSlotGroupIntegrity\(rows, anchor, MAX_SLOTS_PER_VIDEO\)/);
  assert.match(source, /\.limit\(MAX_SLOTS_PER_VIDEO \+ 1\)/);
  assert.match(source, /resolveBoundedGroupIdentity/);
  assert.match(
    source,
    /この枠は現在とは別の活動名義で確保されています。Active X IDを切り替えてから操作してください。/,
  );
  assert.match(
    source,
    /relation === "account_other"[\s\S]*?SLOT_ACCOUNT_OTHER_MESSAGE/,
  );
  assert.match(source, /buildRegroupMutations/);
});
