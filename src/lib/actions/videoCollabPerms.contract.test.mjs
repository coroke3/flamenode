import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(
  new URL("./video-collab-perms.ts", import.meta.url),
  "utf8",
);
const permissionMutationSource = await readFile(
  new URL("../../../packages/server-core/src/video/permissionMutationBatch.ts", import.meta.url),
  "utf8",
);
const permissionSqlSource = await readFile(
  new URL("../../../packages/server-core/src/video/permissionSql.ts", import.meta.url),
  "utf8",
);
const permissionRecipientsSource = await readFile(
  new URL("../../../packages/server-core/src/video/permissionRecipients.ts", import.meta.url),
  "utf8",
);

const permissionProfilesSource = await readFile(
  new URL("../../../packages/server-core/src/video/permissionProfiles.ts", import.meta.url),
  "utf8",
);

const permissionMembersSource = await readFile(
  new URL("../../../packages/server-core/src/video/permissionMembersRead.ts", import.meta.url),
  "utf8",
);

const permissionPlanSource = await readFile(
  new URL("../../../packages/server-core/src/video/permissionPlan.ts", import.meta.url),
  "utf8",
);

const permissionVideoReadSource = await readFile(
  new URL("../../../packages/server-core/src/video/permissionVideoRead.ts", import.meta.url),
  "utf8",
);

const permissionSubjectSource = await readFile(
  new URL("../../../packages/server-core/src/video/permissionSubject.ts", import.meta.url),
  "utf8",
);

const permissionPreparationSource = await readFile(
  new URL("../../../packages/server-core/src/video/permissionPreparation.ts", import.meta.url),
  "utf8",
);

const permissionCanonicalizeSource = await readFile(
  new URL("../../../packages/server-core/src/video/permissionCanonicalize.ts", import.meta.url),
  "utf8",
);

const permissionNotificationInputsSource = await readFile(
  new URL("../../../packages/server-core/src/video/permissionNotificationInputs.ts", import.meta.url),
  "utf8",
);

const permissionRebuildSource = await readFile(
  new URL("../../../packages/server-core/src/video/permissionRebuildTargets.ts", import.meta.url),
  "utf8",
);

function actionBody(name) {
  const match = source.match(
    new RegExp(`export async function ${name}[\\s\\S]*?\\n}`),
  );
  assert.ok(match, `${name} が存在する`);
  return match[0];
}

function functionBody(name, fileSource = source) {
  const match = fileSource.match(
    new RegExp(`(?:async )?function ${name}[\\s\\S]*?\\n}`),
  );
  assert.ok(match, `${name} が存在する`);
  return match[0];
}

test("CURRENT actionはserver-coreの権限SQLと通知先取得を唯一の実装として参照する", () => {
  assert.match(source, /from "@flamenode\/server-core\/video\/permissionMutationBatch"/);
  assert.match(source, /from "@flamenode\/server-core\/video\/permissionRecipients"/);
  for (const name of [
    "buildPermissionSetGuardSql",
    "buildHiddenEditorCountGuardSql",
    "buildXUsersBulkInsertSql",
    "buildMemberPermissionBulkUpdateSql",
    "buildHiddenMemberBulkDeleteSql",
    "loadNotifiableRecipientLinks",
  ]) {
    assert.doesNotMatch(source, new RegExp(`(?:async )?function ${name}\\s*\\(`),
      `${name} のローカル重複実装は禁止`);
  }
});

test("single/batchすべてのactionがwriteGuardを通過する", () => {
  for (const name of [
    "upsertVideoCollaborator",
    "deleteVideoCollaborator",
    "applyVideoCollaboratorPermissionsBatch",
  ]) {
    assert.match(actionBody(name), /await writeGuard\(\{ feature: "edit_video" \}\)/);
  }
});

test("single/batchすべてのactionがwriteGuardと同じD1 bindingを使う", () => {
  assert.doesNotMatch(source, /function getDatabaseForPermissionAction\(\)/);
  for (const name of [
    "upsertVideoCollaborator",
    "deleteVideoCollaborator",
    "applyVideoCollaboratorPermissionsBatch",
  ]) {
    assert.match(actionBody(name), /const db = guard\.db/);
    assert.doesNotMatch(actionBody(name), /getDatabase\(\)/);
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
    new URL("../../../packages/domain/src/video/atomicLimits.ts", import.meta.url),
    "utf8",
  );
  assert.match(atomicLimits, /MAX_COLLABORATOR_PERMISSION_BATCH = 100/);
  const inputSource = await readFile(
    new URL("../../../packages/domain/src/video/collaboratorPermissionInput.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /from "@flamenode\/domain\/video"/);
  assert.match(inputSource, /\.max\(MAX_COLLABORATOR_PERMISSION_BATCH\)/);
  assert.match(inputSource, /isCanonicalXId/);
  assert.match(inputSource, /英数字とアンダースコア20文字以内/);
  assert.match(inputSource, /z\.enum\(\["normal", "admin", "event"\]\)/);
});

test("bulk intentは共通のfail-closed resolverで現行X IDへ解決する", () => {
  const canonicalize = permissionCanonicalizeSource;
  const mutation = functionBody("applyPermissionIntentsToVideo");
  assert.match(canonicalize, /resolveCanonicalXUserResolutions\(db, candidates\)/);
  assert.match(canonicalize, /invalid_alias_target/);
  assert.match(canonicalize, /ambiguous_alias/);
  assert.match(canonicalize, /canonical_alias_collision/);
  assert.match(canonicalize, /rejected_or_invalid/);
  assert.match(mutation, /await preparePermissionWrite\(db, \{/);
  assert.match(permissionPreparationSource, /await canonicalizePermissionIntents\(db, input\.intents\)/);
});

test("aliasと現行IDが同じ正本へ収束した重複intentは共通domainで拒否する", async () => {
  const body = functionBody("applyPermissionIntentsToVideo");
  const inputSource = await readFile(
    new URL("../../../packages/domain/src/video/collaboratorPermissionInput.ts", import.meta.url),
    "utf8",
  );
  assert.match(body, /await preparePermissionWrite\(db, \{/);
  assert.match(permissionPreparationSource, /prepareCollaboratorPermissionIntents\(canonicalIntents\)/);
  assert.match(inputSource, /const duplicateXids = new Set/);
  assert.match(inputSource, /if \(intents\.has\(xid\)\)/);
  assert.match(inputSource, /同じ X ID の権限指定が重複しています/);
});

test("permission mutationはJSON1で対象member\/X userを一括取得する", () => {
  const body = functionBody("applyPermissionIntentsToVideo");
  assert.match(permissionPreparationSource, /loadPermissionMembersRead\(db, input\.videoId, xids\)/);
  assert.match(permissionMembersSource, /json_each\(\$\{xidsPayload\}\)/);
  assert.match(permissionPreparationSource, /loadPermissionGrantProfiles\(db, grantXids\)/);
  assert.match(permissionProfilesSource, /json_each\(\$\{JSON\.stringify\(grantXids\)\}\)/);
  assert.doesNotMatch(source, /PERMISSION_BATCH_IN_CLAUSE_SIZE/);
  assert.doesNotMatch(source, /chunkXIds/);
});

test("permission mutationは集合CAS guardとJSON1 bulk DMLを使う", () => {
  const body = functionBody("applyPermissionIntentsToVideo");
  assert.match(body, /buildPermissionMutationBatch\(db, \{/);
  for (const name of [
    "buildPermissionSetGuardSql", "buildHiddenEditorCountGuardSql",
    "buildXUsersBulkInsertSql", "buildMemberPermissionBulkUpdateSql",
    "buildVideoMemberBulkInsertSql", "buildHiddenMemberBulkDeleteSql",
  ]) assert.match(permissionMutationSource, new RegExp(name));
  assert.match(permissionMutationSource, /plan\.insertHiddenRows\.map\(toVideoMemberSnapshotRow\)/);
  assert.match(body, /mutateWithAudit\(db, \{/);
});

test("X userの同時作成は成功扱いにし、同時rejected化だけatomic assertionで拒否する", () => {
  const builder = functionBody("buildXUsersBulkInsertSql", permissionSqlSource);
  const mutation = functionBody("applyPermissionIntentsToVideo");
  assert.match(builder, /ON CONFLICT\(id\) DO UPDATE SET/);
  assert.match(builder, /id = excluded\.id/);
  assert.match(
    builder,
    /COALESCE\(x_users\.approval_status, 'pending'\) <> 'rejected'/,
  );
  assert.match(permissionMutationSource, /expectedChanges\.push\(plan\.newXUsers\.length\)/);
  assert.match(mutation, /buildPermissionWriteAudits\(\{/);
  assert.match(permissionPlanSource, /operation: "MERGE"/);
});

test("権限batchは公開メンバーの表示名・役割・コメントを書き換えない", () => {
  const body = functionBody("buildMemberPermissionBulkUpdateSql", permissionSqlSource);
  assert.doesNotMatch(body, /name\s*=/);
  assert.doesNotMatch(body, /role\s*=/);
  assert.doesNotMatch(body, /comment\s*=/);
  assert.match(body, /can_edit\s*=/);
  assert.match(body, /edit_granted_by_auth_user_id\s*=/);
});

test("OFF時は全公開行の権限を落とし、全hidden editorを削除する", () => {
  const body = permissionPlanSource;
  assert.match(body, /const publicRows = rowsForXid\.filter/);
  assert.match(body, /const hiddenRows = rowsForXid\.filter/);
  assert.match(body, /for \(const row of publicRows\)/);
  assert.match(body, /updateRows\.push\(\{ \.\.\.row, can_edit: 0/);
  assert.match(body, /for \(const hidden of hiddenRows\)/);
  assert.match(body, /deleteHiddenIds\.push\(hidden\.id\)/);
});

test("ON時もpublic+hidden重複をX ID単位で統合する", () => {
  const body = permissionPlanSource;
  assert.match(permissionMembersSource, /const rowsByXid = new Map/);
  assert.match(body, /if \(publicRows\.length > 0\)/);
  assert.match(body, /for \(const target of publicRows\)/);
  assert.match(body, /for \(const hidden of hiddenRows\)/);
  assert.match(body, /hiddenRows\.slice\(1\)/);
});

test("hidden editor上限は公開100人と分離し全intent後のnet countで判定する", async () => {
  const atomicLimits = await readFile(
    new URL("../../../packages/domain/src/video/atomicLimits.ts", import.meta.url),
    "utf8",
  );
  const body = functionBody("applyPermissionIntentsToVideo");
  const loopIndex = permissionPlanSource.indexOf("for (const [xid, intentInfo] of intents)");
  const netCheckIndex = permissionPlanSource.indexOf("plan.nextHiddenEditorCount > MAX_VIDEO_HIDDEN_EDITORS");
  assert.ok(loopIndex >= 0);
  assert.ok(netCheckIndex > loopIndex);
  assert.match(permissionPreparationSource, /planVideoPermissionChanges\(\{/);
  assert.match(permissionPreparationSource, /evaluatePermissionPlanPreflight\(plan\)/);
  assert.match(permissionPlanSource, /nextHiddenEditorCount/);
  assert.match(atomicLimits, /MAX_VIDEO_HIDDEN_EDITORS = 100/);
});

test("対象member readが上限に達した場合は重複データを黙って切り捨てない", () => {
  const body = functionBody("applyPermissionIntentsToVideo");
  assert.match(permissionPreparationSource, /loadPermissionMembersRead\(db, input\.videoId, xids\)/);
  assert.match(
    permissionMembersSource,
    /const existingRowLimit = MAX_VIDEO_MEMBERS \+ MAX_VIDEO_HIDDEN_EDITORS \+ 1/,
  );
  assert.match(permissionMembersSource, /existingRows\.length >= existingRowLimit/);
  assert.match(permissionMembersSource, /重複データを整理してください/);
});

test("拒否済みX IDへ編集権限を再付与しない", () => {
  const body = functionBody("applyPermissionIntentsToVideo");
  assert.match(permissionProfilesSource, /approval_status: xUsers\.approval_status/);
  assert.match(permissionPreparationSource, /row\.approval_status === "rejected"/);
  assert.match(permissionPreparationSource, /拒否済みの X ID には編集権限を付与できません/);
});

test("permission CASのID順はlocaleCompareでなくSQLite互換比較を使う", () => {
  assert.match(permissionPlanSource, /compareSqliteBinaryText/);
  assert.match(permissionSqlSource, /compareSqliteBinaryText/);
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
  const resolver = functionBody("loadNotifiableRecipientLinks", permissionRecipientsSource);
  const body = functionBody("applyPermissionIntentsToVideo");
  assert.match(resolver, /\.innerJoin\(xUsers/);
  assert.match(resolver, /\.innerJoin\(users/);
  assert.match(resolver, /eq\(xUsers\.approval_status, "approved"\)/);
  assert.match(resolver, /eq\(users\.is_notification_enabled, 1\)/);
  assert.match(resolver, /json_each\(\$\{payload\}\)/);
  assert.match(body, /buildPermissionGrantNotificationInputs\(\{/);
  assert.match(permissionNotificationInputsSource, /selectVideoPermissionNotificationTargets\(/);
  assert.match(body, /buildKnownRecipientNotificationBulkBatch\(/);
  assert.match(body, /notificationInputs\.slice\(offset, offset \+ 200\)/);
  assert.doesNotMatch(source, /getAuthUserIdsForXUser/);
  assert.doesNotMatch(source, /buildKnownRecipientNotificationBatch/);
});

test("batch監査は1人1auditでなく集合snapshotにまとめる", () => {
  const body = functionBody("applyPermissionIntentsToVideo");
  assert.match(body, /buildPermissionWriteAudits\(\{/);
  assert.match(permissionPlanSource, /table_name: "video_member_permissions_batch"/);
  assert.match(permissionPlanSource, /table_name: "x_users_permission_batch"/);
  assert.match(permissionPlanSource, /operation: "MERGE"/);
  assert.match(permissionPlanSource, /restore_strategy: "none"/);
  assert.match(body, /mutateWithAudit\(db, \{/);
});

test("member_suggestions dirty登録は本体mutationと同じatomic writeへ含まれる", () => {
  const body = functionBody("applyPermissionIntentsToVideo");
  assert.match(body, /buildStaticRebuildQueueBatch\(db, permissionRebuildTargets\(\{/);
  assert.match(body, /permissionRebuildTargets\(\{/);
  assert.match(permissionRebuildSource, /memberSuggestionsTarget\("video_permissions_batch"\)/);
  assert.match(permissionRebuildSource, /visibilityStatus === "public"/);
  assert.match(body, /statements\.push\(\.\.\.queue\.statements\)/);
  assert.match(body, /staticRebuildWakeSource/);
});

test("新規pending X ID作成時はusers_indexも同じqueue batchへ含める", () => {
  const body = functionBody("applyPermissionIntentsToVideo");
  assert.match(body, /newXUsers\.length > 0/);
  assert.match(permissionRebuildSource, /targetType: "users_index"/);
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
  assert.match(source, /from "@flamenode\/server-core\/video\/permissionSubject"/);
  for (const action of ["upsertVideoCollaborator", "deleteVideoCollaborator"]) {
    assert.match(actionBody(action), /resolvePermissionSubjectXUserId\(\s*db,/);
  }
  assert.match(permissionSubjectSource, /resolveCanonicalXUserResolutions\(db, \[normalized\]\)/);
  assert.match(permissionSubjectSource, /getApprovedLinkedXUserIds\(db, authUserId\)/);
});

test("SA-082..084 video read is scoped in server-core before CURRENT authorization", () => {
  assert.match(source, /loadPermissionVideoRow\(db, videoId\)/);
  assert.match(permissionVideoReadSource, /\.where\(eq\(videos\.id, videoId\)\)/);
  assert.match(permissionVideoReadSource, /\.limit\(1\)/);
  assert.match(source, /requiredKey: "video\.permissions"/);
});
