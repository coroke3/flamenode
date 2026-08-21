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

test("batch actionはvideo.permissions権限を再検証してから差分適用する", () => {
  const body = actionBody("applyVideoCollaboratorPermissionsBatch");
  // 権限検証はloadEditableVideoForPermissions（canEditVideo requiredKey video.permissions）経由。
  assert.match(body, /loadEditableVideoForPermissions\(/);
  assert.match(
    source,
    /requiredKey: "video\.permissions"/,
  );
  // privilege modeの再検証。
  assert.match(source, /resolvePrivilegeMode\(/);
  // 差分適用: unchanged / grant / revokeが明示的に分かれている。
  assert.match(body, /unchanged \+= 1/);
  assert.match(body, /intent === "on"/);
});

test("batch actionはexpectedRowConditionとmutateWithAuditでatomicに書く", () => {
  const body = actionBody("applyVideoCollaboratorPermissionsBatch");
  assert.match(body, /expectedRowCondition\(\{ expectedCurrent:/);
  assert.match(body, /mutateWithAudit\(db, \{/);
  assert.match(body, /retention_class: "long_audit"/);
  // 監査は各変更に残る（CREATE / UPDATE / DELETEのoperationを含む）。
  assert.ok(/operation: "UPDATE"/.test(body));
  assert.ok(/operation: "CREATE"/.test(body));
});

test("batch actionはX IDをnormalizeし重複を排除する", () => {
  const body = actionBody("applyVideoCollaboratorPermissionsBatch");
  assert.match(body, /normalizeXId\(item\.x_user_id\)/);
  assert.match(body, /intents\.has\(xid\)/);
});

test("OFF時もsingle actionと同じ行扱い: 公開行は保持、非公開編集者専用行は削除", () => {
  const body = actionBody("applyVideoCollaboratorPermissionsBatch");
  assert.match(body, /is_public_member === 0/);
  assert.match(body, /operation: deleteRow \? "DELETE" : "UPDATE"/);
  const deleteBody = actionBody("deleteVideoCollaborator");
  assert.match(deleteBody, /existing\.is_public_member === 0/);
});

test("members_jsonからはcan_editを読まない（schema側で剥がす）", async () => {
  const memberInputs = await readFile(
    new URL("../video/memberInputs.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(memberInputs, /can_edit/);
});

test("batch actionはMAX_VIDEO_MEMBERSとバッチ上限を守る", async () => {
  const body = actionBody("applyVideoCollaboratorPermissionsBatch");
  assert.match(body, /MAX_VIDEO_MEMBERS/);
  const atomicLimits = await readFile(
    new URL("../video/atomicLimits.ts", import.meta.url),
    "utf8",
  );
  // 上限定数はclient共有モジュールに置く（"use server"ファイルはasync関数しかexportできない）。
  assert.match(atomicLimits, /MAX_COLLABORATOR_PERMISSION_BATCH = \d+/);
  // バッチ上限はzod schemaで強制される。
  assert.match(source, /\.max\(MAX_COLLABORATOR_PERMISSION_BATCH\)/);
});

test("付与時の通知はsingle actionと同じ意味論を共有する", () => {
  const body = actionBody("applyVideoCollaboratorPermissionsBatch");
  assert.match(body, /buildKnownRecipientNotificationBatch\(/);
  assert.match(body, /buildVideoEditPermissionGrantedNotification\(/);
  const single = actionBody("upsertVideoCollaborator");
  assert.match(single, /buildKnownRecipientNotificationBatch\(/);
});

test("member_suggestions再生成は本体mutationと同じatomic writeへ含まれる", () => {
  const body = actionBody("applyVideoCollaboratorPermissionsBatch");
  assert.match(body, /buildStaticRebuildQueueBatch\(db, \[\s*memberSuggestionsTarget\(/);
  assert.match(body, /\.\.\.queue\.statements/);
});

test("batch existing-row read is bounded in SQL and preparation failures are returned", () => {
  const body = actionBody("applyVideoCollaboratorPermissionsBatch");
  assert.match(body, /\.limit\(MAX_VIDEO_MEMBERS \+ xids\.length\)/);
  assert.match(body, /let db: ReturnType<typeof getDatabase>/);
  assert.match(body, /database binding unavailable/);
  assert.match(body, /try \{\s*const video = await loadEditableVideoForPermissions/);
  assert.match(body, /batch preparation failed/);
});
test("single collaborator actions keep D1 read and queue-plan failures inside the UI error boundary", () => {
  const upsert = actionBody("upsertVideoCollaborator");
  assert.match(upsert, /try \{\s*const video = await loadEditableVideo/);
  assert.match(upsert, /collaborator action failed/);

  const revoke = actionBody("deleteVideoCollaborator");
  assert.match(revoke, /try \{\s*const video = await loadEditableVideo/);
  assert.match(revoke, /collaborator revoke failed/);
});
