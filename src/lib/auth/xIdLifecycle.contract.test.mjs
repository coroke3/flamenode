import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { planD1AuditMutationBudget } from "../audit/mutateBudget.ts";

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("header X ID read pathは未連携active行を自動claimしない", () => {
  const source = read("./headerUser.ts");
  assert.doesNotMatch(source, /\.update\(xUsers\)/);
  assert.doesNotMatch(source, /or\(\.\.\.rowConditions/);
  assert.match(source, /getLinkedXUsersForAuthUser\(db, authUserId\)/);
});

test("Discord auth linkは内部user ID更新・token消去・監査を単一batchにする", () => {
  const source = read("./index.ts");
  const adapter = read("./accountLinkAdapter.ts");
  assert.match(source, /linkDiscordAccountAtomically\(db, account\)/);
  assert.doesNotMatch(source, /events:\s*\{[\s\S]*linkAccount/);
  assert.match(adapter, /await mutate\(db,/);
  assert.match(adapter, /db\.insert\(accounts\)\.values\(accountRow\)/);
  assert.match(adapter, /expectedRowCondition\(\{/);
  assert.match(adapter, /discord_id: beforeUser\.discord_id/);
  assert.match(adapter, /buildNotificationOutboxStatement/);
  assert.match(adapter, /welcomeNotification\.statement/);
  assert.match(adapter, /welcome_account/);
  assert.match(adapter, /expectedMutationChanges/);
  assert.match(adapter, /discord_id: account\.providerAccountId/);
  assert.match(adapter, /access_token: null/);
  assert.match(adapter, /refresh_token: null/);
  assert.match(adapter, /onConflictDoNothing/);
});

test("一般X ID lifecycleは逐次audit writeを残さずCAS付きatomic batchを使う", () => {
  const source = read("../actions/xid.ts");
  assert.doesNotMatch(source, /auditAction\(/);
  assert.ok((source.match(/await mutateWithAudit\(db,/g) ?? []).length >= 6);
  assert.match(source, /expectedRowCondition\(\{ expectedCurrent: row \}\)/);
  assert.match(source, /xicons\/staging/);
  assert.match(source, /Promise\.allSettled\(\[env\.BUCKET\.delete\(stagingKey\), env\.BUCKET\.delete\(key\)\]\)/);
  assert.match(source, /type: "discord_webhook"/);
  assert.match(source, /xid_request_webhook:/);
  assert.match(source, /webhookNotification\.statement/);
});

test("imported 等の非 approved X ID はプロフィール・アイコン更新を拒否する", () => {
  const source = read("../actions/xid.ts");
  assert.match(source, /function requireApprovedForEdit/);
  assert.match(source, /承認済みの X ID だけを編集できます。/);
  assert.match(source, /updateXIdProfile[\s\S]*requireApprovedForEdit\(row\)/);
  assert.match(source, /setXIdIcon[\s\S]*requireApprovedForEdit\(row\)/);
  assert.match(source, /uploadXIdIcon[\s\S]*requireApprovedForEdit\(row\)/);
});

test("本人X IDプロフィール・アイコン更新はmutation成功後に静的queueへenqueueする", () => {
  const source = read("../actions/xid.ts");
  assert.match(source, /enqueueAfterXUserPublicUpdate/);
  assert.match(
    source,
    /updateXIdProfile[\s\S]*await mutateWithAudit\(db,[\s\S]*await enqueueAfterXUserPublicUpdate/,
  );
  assert.match(
    source,
    /setXIdIcon[\s\S]*await mutateWithAudit\(db,[\s\S]*await enqueueAfterXUserPublicUpdate/,
  );
  assert.match(
    source,
    /uploadXIdIcon[\s\S]*await mutateWithAudit\(db,[\s\S]*await enqueueAfterXUserPublicUpdate/,
  );
});

test("管理X ID lifecycleは通知を含むatomic batch、merge状態はCAS付き監査を使う", () => {
  const admin = read("../actions/xid-admin.ts");
  const merge = read("../actions/xid-merge-admin.ts");
  const mergeCore = read("../xid/merge.ts");
  assert.doesNotMatch(admin, /auditAction\(|enqueueNotification\(/);
  assert.match(admin, /canManageXIdLinkRequests/);
  assert.match(admin, /buildNotificationOutboxStatement/);
  assert.match(admin, /notification\.statement/);
  assert.match(admin, /xid_reject_webhook:/);
  assert.match(admin, /where\(eq\(xUsers\.id, effectiveXUserId\)\)/);
  assert.match(admin, /if \(!duplicateLink\)/);
  assert.match(admin, /processedXIdRequestMessage\(request\.status, "approve"\)/);
  assert.match(admin, /processedXIdRequestMessage\(request\.status, "reject"\)/);
  assert.ok((admin.match(/await mutateWithAudit\(/g) ?? []).length >= 2);
  assert.doesNotMatch(merge, /auditAction\(/);
  assert.match(merge, /executeApprovedXIdMergeRequest/);
  assert.match(merge, /restoreApprovedXIdMergeRevertRequest/);
  assert.ok(
    ((merge.match(/await mutateWithAudit\(/g) ?? []).length +
      (mergeCore.match(/await mutateWithAudit\(/g) ?? []).length) >= 4,
  );
  assert.match(merge, /expectedRowCondition\(\{ expectedCurrent: current \}\)/);
});

test("X ID lifecycleの最大atomic planはD1 50 query以内に収まる", () => {
  const budget = planD1AuditMutationBudget({
    mutationStatementCount: 4,
    mutationAssertionCount: 4,
    auditEntryCount: 3,
    distinctActorCount: 1,
  });
  assert.equal(budget.totalQueryCount, 22);
  assert.equal(budget.withinLimit, true);
  assert.ok(4 * 21 < 100, "最大4行の監査chunkも100 bind未満である");
});
