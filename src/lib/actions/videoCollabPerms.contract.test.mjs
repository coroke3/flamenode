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

function functionBody(name) {
  const match = source.match(
    new RegExp(`(?:async )?function ${name}[\\s\\S]*?\\n}`),
  );
  assert.ok(match, `${name} が存在する`);
  return match[0];
}

test("single/batchすべてのactionがwriteGuardを通過する", () => {
  for (const name of [
    "upsertVideoCollaborator",
    "deleteVideoCollaborator",
    "applyVideoCollaboratorPermissionsBatch",
  ]) {
    assert.match(actionBody(name), /await writeGuard\(\{ feature: "edit_video" \}\)/);
  }
});

test("D1 binding unavailableは共通helperでUI向け失敗へ収束する", () => {
  assert.match(source, /function getDatabaseForPermissionAction\(\)/);
  assert.match(source, /database binding unavailable/);
  assert.match(source, /unstable_rethrow\(error\)/);
  for (const name of [
    "upsertVideoCollaborator",
    "deleteVideoCollaborator",
    "applyVideoCollaboratorPermissionsBatch",
  ]) {
    assert.match(actionBody(name), /getDatabaseForPermissionAction\(\)/);
  }
});

test("single/batchともvideo.permissionsとprivilege modeをServer側で再検証する", () => {
  for (const name of [
    "upsertVideoCollaborator",
    "deleteVideoCollaborator",
    "applyVideoCollaboratorPermissionsBatch",
  ]) {
    assert.match(actionBody(name), /loadEditableVideoForPermissions\(/);
  }
  assert.match(source, /requiredKey: "video\.permissions"/);
  assert.match(source, /resolvePrivilegeMode\(/);
  assert.match(source, /canUseEventPrivilegeModeForVideo/);
  assert.match(source, /actor\.role === "admin"/);
});

test("permission inputは最大100件かつcanonical X handle形式だけ許可する", async () => {
  const atomicLimits = await readFile(
    new URL("../video/atomicLimits.ts", import.meta.url),
    "utf8",
  );
  assert.match(atomicLimits, /MAX_COLLABORATOR_PERMISSION_BATCH = 100/);
  assert.match(source, /\.max\(MAX_COLLABORATOR_PERMISSION_BATCH\)/);
  assert.match(source, /isCanonicalXId/);
  assert.match(source, /英数字とアンダースコア20文字以内/);
  assert.match(source, /z\.enum\(\["normal", "admin", "event"\]\)/);
});

test("bulk intentはx_user_aliasesをJSON1 1クエリで現行X IDへ解決する", () => {
  const canonicalize = functionBody("canonicalizePermissionIntents");
  const mutation = functionBody("applyPermissionIntentsToVideo");
  assert.match(canonicalize, /xUserAliases\.alias_x_id/);
  assert.match(canonicalize, /json_each\(\$\{JSON\.stringify\(candidates\)\}\)/);
  assert.match(canonicalize, /ambiguous_x_user_alias/);
  assert.match(canonicalize, /invalid_x_user_alias_target/);
  assert.match(mutation, /await canonicalizePermissionIntents\(db, args\.intents\)/);
});

test("aliasと現行IDが同じ正本へ収束した重複intentは先勝ちにせず拒否する", () => {
  const body = functionBody("applyPermissionIntentsToVideo");
  assert.match(body, /const duplicateXids = new Set/);
  assert.match(body, /if \(intents\.has\(xid\)\)/);
  assert.match(body, /同じ X ID の権限指定が重複しています/);
});

test("permission mutationはJSON1で対象member\/X userを一括取得する", () => {
  const body = functionBody("applyPermissionIntentsToVideo");
  assert.match(body, /json_each\(\$\{xidsPayload\}\)/);
  assert.match(body, /json_each\(\$\{JSON\.stringify\(grantXids\)\}\)/);
  assert.doesNotMatch(source, /PERMISSION_BATCH_IN_CLAUSE_SIZE/);
  assert.doesNotMatch(source, /chunkXIds/);
});

test("permission mutationは集合CAS guardとJSON1 bulk DMLを使う", () => {
  const body = functionBody("applyPermissionIntentsToVideo");
  assert.match(body, /buildPermissionSetGuardSql/);
  assert.match(body, /buildHiddenEditorCountGuardSql/);
  assert.match(body, /buildXUsersBulkInsertSql/);
  assert.match(body, /buildMemberPermissionBulkUpdateSql/);
  assert.match(body, /buildHiddenMemberBulkInsertSql/);
  assert.match(body, /buildHiddenMemberBulkDeleteSql/);
  assert.match(body, /mutateWithAudit\(db, \{/);
});

test("X userの同時作成は成功扱いにし、同時rejected化だけatomic assertionで拒否する", () => {
  const builder = functionBody("buildXUsersBulkInsertSql");
  const mutation = functionBody("applyPermissionIntentsToVideo");
  assert.match(builder, /ON CONFLICT\(id\) DO UPDATE SET/);
  assert.match(builder, /id = excluded\.id/);
  assert.match(
    builder,
    /COALESCE\(x_users\.approval_status, 'pending'\) <> 'rejected'/,
  );
  assert.match(mutation, /expected\.push\(newXUsers\.length\)/);
  assert.match(mutation, /operation: "MERGE"/);
});

test("権限batchは公開メンバーの表示名・役割・コメントを書き換えない", () => {
  const body = functionBody("buildMemberPermissionBulkUpdateSql");
  assert.doesNotMatch(body, /name\s*=/);
  assert.doesNotMatch(body, /role\s*=/);
  assert.doesNotMatch(body, /comment\s*=/);
  assert.match(body, /can_edit\s*=/);
  assert.match(body, /edit_granted_by_auth_user_id\s*=/);
});

test("OFF時は全公開行の権限を落とし、全hidden editorを削除する", () => {
  const body = functionBody("applyPermissionIntentsToVideo");
  assert.match(body, /const publicRows = rowsForXid\.filter/);
  assert.match(body, /const hiddenRows = rowsForXid\.filter/);
  assert.match(body, /for \(const row of publicRows\)/);
  assert.match(body, /updateRows\.push\(\{ \.\.\.row, can_edit: 0/);
  assert.match(body, /for \(const hidden of hiddenRows\)/);
  assert.match(body, /deleteHiddenIds\.push\(hidden\.id\)/);
});

test("ON時もpublic+hidden重複をX ID単位で統合する", () => {
  const body = functionBody("applyPermissionIntentsToVideo");
  assert.match(body, /const rowsByXid = new Map/);
  assert.match(body, /if \(publicRows\.length > 0\)/);
  assert.match(body, /for \(const target of publicRows\)/);
  assert.match(body, /for \(const hidden of hiddenRows\)/);
  assert.match(body, /hiddenRows\.slice\(1\)/);
});

test("hidden editor上限は公開100人と分離し全intent後のnet countで判定する", async () => {
  const atomicLimits = await readFile(
    new URL("../video/atomicLimits.ts", import.meta.url),
    "utf8",
  );
  const body = functionBody("applyPermissionIntentsToVideo");
  const loopIndex = body.indexOf("for (const [xid, intentInfo] of intents)");
  const netCheckIndex = body.indexOf("nextHiddenEditorCount > MAX_VIDEO_HIDDEN_EDITORS");
  assert.ok(loopIndex >= 0);
  assert.ok(netCheckIndex > loopIndex);
  assert.match(atomicLimits, /MAX_VIDEO_HIDDEN_EDITORS = 100/);
});

test("対象member readが上限に達した場合は重複データを黙って切り捨てない", () => {
  const body = functionBody("applyPermissionIntentsToVideo");
  assert.match(
    body,
    /const existingRowLimit = MAX_VIDEO_MEMBERS \+ MAX_VIDEO_HIDDEN_EDITORS \+ 1/,
  );
  assert.match(body, /existingRows\.length >= existingRowLimit/);
  assert.match(body, /重複データを整理してください/);
});

test("拒否済みX IDへ編集権限を再付与しない", () => {
  const body = functionBody("applyPermissionIntentsToVideo");
  assert.match(body, /approval_status: xUsers\.approval_status/);
  assert.match(body, /row\.approval_status === "rejected"/);
  assert.match(body, /拒否済みの X ID には編集権限を付与できません/);
});

test("permission CASのID順はlocaleCompareでなくSQLite互換比較を使う", () => {
  assert.match(source, /compareSqliteBinaryText/);
  assert.doesNotMatch(source, /id\.localeCompare/);
});

test("members_jsonからはcan_editを読まない", async () => {
  const memberInputs = await readFile(
    new URL("../video/memberInputs.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(memberInputs, /can_edit/);
});

test("通知先は承認済みX ID連携かつ通知ONのAuth userだけを一括取得する", () => {
  const resolver = functionBody("loadNotifiableRecipientLinks");
  const body = functionBody("applyPermissionIntentsToVideo");
  assert.match(resolver, /\.innerJoin\(xUsers/);
  assert.match(resolver, /\.innerJoin\(users/);
  assert.match(resolver, /eq\(xUsers\.approval_status, "approved"\)/);
  assert.match(resolver, /eq\(users\.is_notification_enabled, 1\)/);
  assert.match(resolver, /json_each\(\$\{payload\}\)/);
  assert.match(body, /buildKnownRecipientNotificationBulkBatch\(/);
  assert.match(body, /notificationInputs\.slice\(offset, offset \+ 200\)/);
  assert.doesNotMatch(source, /getAuthUserIdsForXUser/);
  assert.doesNotMatch(source, /buildKnownRecipientNotificationBatch/);
});

test("batch監査は1人1auditでなく集合snapshotにまとめる", () => {
  const body = functionBody("applyPermissionIntentsToVideo");
  assert.match(body, /table_name: "video_member_permissions_batch"/);
  assert.match(body, /operation: "MERGE"/);
  assert.match(body, /restore_strategy: "none"/);
});

test("member_suggestions dirty登録は本体mutationと同じatomic writeへ含まれる", () => {
  const body = functionBody("applyPermissionIntentsToVideo");
  assert.match(body, /buildStaticRebuildQueueBatch\(db, \[/);
  assert.match(body, /memberSuggestionsTarget\("video_permissions_batch"\)/);
  assert.match(body, /statements\.push\(\.\.\.queue\.statements\)/);
  assert.match(body, /staticRebuildWakeSource/);
});

test("single grant/revokeとTSV batchは同じpermission mutation正本を使う", () => {
  for (const name of [
    "upsertVideoCollaborator",
    "deleteVideoCollaborator",
    "applyVideoCollaboratorPermissionsBatch",
  ]) {
    assert.match(actionBody(name), /applyPermissionIntentsToVideo\(/);
  }
  assert.doesNotMatch(source, /expectedRowCondition/);
});

test("single actionも統合済みaliasを現在のX IDへ解決してから権限を操作する", () => {
  const resolver = functionBody("resolveSubjectXUserId");
  assert.match(resolver, /resolveCanonicalXUserId/);
  assert.match(resolver, /approvedOnly: true/);
});
