import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./video-collab-perms.ts", import.meta.url),
  "utf8",
);

function actionBody(name) {
  const match = source.match(
    new RegExp(`export async function ${name}[\\s\\S]*?\\n}`),
  );
  assert.ok(match, `${name} が存在する`);
  return match[0];
}

test("single/batch両actionがwriteGuardを通過する", () => {
  for (const name of [
    "upsertVideoCollaborator",
    "deleteVideoCollaborator",
    "applyVideoCollaboratorPermissionsBatch",
  ]) {
    assert.match(actionBody(name), /await writeGuard\(\{ feature: "edit_video" \}\)/);
  }
});

test("D1 binding unavailable時もcollaborator actionsはUI向け失敗へ収束する", () => {
  for (const name of [
    "upsertVideoCollaborator",
    "deleteVideoCollaborator",
    "applyVideoCollaboratorPermissionsBatch",
  ]) {
    assert.match(actionBody(name), /database binding unavailable/);
  }
});

test("batch actionはvideo.permissions権限とprivilege modeをServer側で再検証する", () => {
  const body = actionBody("applyVideoCollaboratorPermissionsBatch");
  assert.match(body, /loadEditableVideoForPermissions\(/);
  assert.match(source, /requiredKey: "video\.permissions"/);
  assert.match(source, /resolvePrivilegeMode\(/);
  assert.match(source, /canUseEventPrivilegeModeForVideo/);
  assert.match(source, /actor\.role === "admin"/);
});

test("batch actionは最大100 intentをschemaで強制する", async () => {
  const atomicLimits = await readFile(
    new URL("../video/atomicLimits.ts", import.meta.url),
    "utf8",
  );
  assert.match(atomicLimits, /MAX_COLLABORATOR_PERMISSION_BATCH = 100/);
  assert.match(source, /\.max\(MAX_COLLABORATOR_PERMISSION_BATCH\)/);
});

test("batch actionは通常IN展開でなくJSON1で対象member/X userを一括取得する", () => {
  const body = actionBody("applyVideoCollaboratorPermissionsBatch");
  assert.match(body, /json_each\(\$\{xidsPayload\}\)/);
  assert.match(body, /json_each\(\$\{JSON\.stringify\(grantXids\)\}\)/);
  assert.doesNotMatch(body, /PERMISSION_BATCH_IN_CLAUSE_SIZE/);
  assert.doesNotMatch(body, /chunkXIds/);
});

test("batch mutationは集合CAS guardとJSON1 bulk DMLを使う", () => {
  const body = actionBody("applyVideoCollaboratorPermissionsBatch");
  assert.match(body, /buildPermissionSetGuardSql/);
  assert.match(body, /buildMemberCountGuardSql/);
  assert.match(body, /buildXUsersBulkInsertSql/);
  assert.match(body, /buildMemberPermissionBulkUpdateSql/);
  assert.match(body, /buildHiddenMemberBulkInsertSql/);
  assert.match(body, /buildHiddenMemberBulkDeleteSql/);
  assert.match(body, /mutateWithAudit\(db, \{/);
});

test("OFF時は公開行を保持しhidden editorだけ削除する", () => {
  const body = actionBody("applyVideoCollaboratorPermissionsBatch");
  assert.match(body, /existing\.is_public_member === 0/);
  assert.match(body, /deleteHiddenIds\.push\(existing\.id\)/);
  assert.match(body, /updateRows\.push\(\{ \.\.\.existing, can_edit: 0/);
});

test("members_jsonからはcan_editを読まない（schema側で剥がす）", async () => {
  const memberInputs = await readFile(
    new URL("../video/memberInputs.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(memberInputs, /can_edit/);
});

test("100人通知はX linkを一括取得しJSON1 outbox bulk builderへ渡す", () => {
  const body = actionBody("applyVideoCollaboratorPermissionsBatch");
  assert.match(body, /xUserAccountLinks/);
  assert.match(body, /json_each\(\$\{JSON\.stringify\(notifyXids\)\}\)/);
  assert.match(body, /buildKnownRecipientNotificationBulkBatch\(/);
  assert.doesNotMatch(body, /await getAuthUserIdsForXUser\(db, xid\)/);
  const single = actionBody("upsertVideoCollaborator");
  assert.match(single, /getAuthUserIdsForXUser/);
  assert.match(single, /buildKnownRecipientNotificationBatch\(/);
});

test("batch監査は1人1auditでなく集合snapshotにまとめる", () => {
  const body = actionBody("applyVideoCollaboratorPermissionsBatch");
  assert.match(body, /table_name: "video_member_permissions_batch"/);
  assert.match(body, /operation: "MERGE"/);
  assert.match(body, /restore_strategy: "none"/);
  assert.doesNotMatch(body, /for \(const \[xid, intentInfo\] of intents\)[\s\S]*?audits\.push\(\{[\s\S]*?target_id: existing\.id/);
});

test("member_suggestions dirty登録は本体mutationと同じatomic writeへ含まれる", () => {
  const body = actionBody("applyVideoCollaboratorPermissionsBatch");
  assert.match(body, /buildStaticRebuildQueueBatch\(db, \[/);
  assert.match(body, /memberSuggestionsTarget\("video_permissions_batch"\)/);
  assert.match(body, /statements\.push\(\.\.\.queue\.statements\)/);
  assert.match(body, /staticRebuildWakeSource/);
});

test("single collaborator actionsは既存のrow CASと個別監査を維持する", () => {
  const upsert = actionBody("upsertVideoCollaborator");
  const revoke = actionBody("deleteVideoCollaborator");
  assert.match(upsert, /expectedRowCondition\(\{ expectedCurrent:/);
  assert.match(upsert, /retention_class: "long_audit"/);
  assert.match(revoke, /expectedRowCondition\(\{ expectedCurrent:/);
  assert.match(revoke, /retention_class: "long_audit"/);
});
