import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const managerSource = await readFile(
  new URL("./VideoCollabPermsManager.tsx", import.meta.url),
  "utf8",
);
const loaderSource = await readFile(
  new URL("../../lib/video/collabPerms.ts", import.meta.url),
  "utf8",
);
const ownershipSource = await readFile(
  new URL("../../lib/auth/ownership.ts", import.meta.url),
  "utf8",
);
const summarySource = await readFile(
  new URL("../video/VideoEditPermissionSummary.tsx", import.meta.url),
  "utf8",
);

test("共同編集権限UIはDiscord Snowflake直接入力ではなくX IDを正本にする", () => {
  assert.match(managerSource, /編集権限は X ID に付与されます/);
  assert.match(managerSource, /placeholder="X ID \(@ なし・必須\)"/);
  assert.doesNotMatch(managerSource, /placeholder="Discord User ID/);
  assert.match(managerSource, /parseCanonicalXId/);
  assert.match(managerSource, /pattern="\[A-Za-z0-9_\]\{1,20\}"/);
  assert.match(managerSource, /maxLength=\{20\}/);
  assert.match(managerSource, /canonicalXUserId !== null/);
});

test("X IDなし・不正な公開メンバーは押しても失敗する付与候補として表示しない", () => {
  const candidates = managerSource.match(
    /const grantCandidates = publicMembers\.filter\([\s\S]*?\n  \}\);/,
  )?.[0];
  assert.ok(candidates);
  assert.match(candidates, /const candidateXId = parseCanonicalXId\(p\.x_user_id\)/);
  assert.match(candidates, /if \(!candidateXId\) return false/);
  assert.match(candidates, /parseCanonicalXId\(s\.x_user_id\) === candidateXId/);
  assert.doesNotMatch(candidates, /!p\.x_user_id\?\.trim\(\) && !p\.display_name\.trim\(\)/);
});

test("権限送信前にもX IDをcanonical化してServerと同じ20文字制約を使う", () => {
  const submit = managerSource.match(/const submitUpsert = [\s\S]*?\n  };/)?.[0];
  assert.ok(submit);
  assert.match(submit, /const xUserId = resolvedSubjectXId\(draft\)/);
  assert.match(submit, /fd\.set\("x_user_id", xUserId\)/);
  assert.match(submit, /英数字とアンダースコア20文字以内/);
});

test("未連携can_edit行を編集可能と誤表示しない", () => {
  assert.match(managerSource, /linked \? "編集可能" : "権限付与済み"/);
  assert.match(managerSource, /X ID連携待ち/);
  assert.match(managerSource, /連携完了までは編集できません/);
});

test("権限一覧の連携済み判定はX ID approval_status=approvedを要求する", () => {
  assert.match(loaderSource, /INNER JOIN \$\{xUsers\} xu ON xu\.id = link\.x_user_id/);
  assert.match(loaderSource, /xu\.approval_status = 'approved'/);
});

test("通知可能人数は承認済みX ID連携かつユーザー通知ONだけを数える", () => {
  assert.match(loaderSource, /has_notifiable_link/);
  assert.match(loaderSource, /INNER JOIN \$\{users\} auth_user ON auth_user\.id = link\.auth_user_id/);
  assert.match(loaderSource, /auth_user\.is_notification_enabled = 1/);
  assert.match(loaderSource, /can_notify: row\.has_notifiable_link === 1/);
  assert.match(loaderSource, /if \(editor\.can_notify\) notifiableEditorCount \+= 1/);
  assert.doesNotMatch(loaderSource, /notifiableEditorCount: editors\.length - unlinkedEditorCount/);
});

test("権限summaryはX ID DTOへAuth/Discord IDを混ぜて他人判定しない", () => {
  assert.match(loaderSource, /user_id: null/);
  assert.match(loaderSource, /権限正本はX ID/);
  assert.doesNotMatch(loaderSource, /editor\.user_id\?\.trim\(\)/);
  assert.doesNotMatch(loaderSource, /他のメンバーにも編集権限が設定されています/);
});

test("実際の合作所有者判定もcan_edit=1と承認済みX IDの両方を要求する", () => {
  assert.match(ownershipSource, /eq\(videoMembers\.can_edit, 1\)/);
  assert.match(ownershipSource, /approvedXIdsWhere\(videoMembers\.x_user_id/);
  assert.match(ownershipSource, /hasCollaboratorEdit = rows\.length > 0/);
});

test("メンバー欄の権限設定アンカーは実在し専用管理ページへ到達できる", () => {
  assert.match(summarySource, /id="video-collab-perms"/);
  assert.match(summarySource, /\/dashboard\/edit\/\$\{encodeURIComponent\(videoId\)\}\/permissions/);
  assert.match(summarySource, /編集できる人を管理/);
});

test("手動解除も1行deleteではなくX ID集合batchへ統一する", () => {
  const revoke = managerSource.match(/const submitRevoke = [\s\S]*?\n  };/)?.[0];
  assert.ok(revoke);
  assert.match(revoke, /applyVideoCollaboratorPermissionsBatch/);
  assert.match(revoke, /intent: "off"/);
  assert.match(revoke, /edit_privilege_mode: editPrivilegeMode/);
  assert.doesNotMatch(revoke, /deleteVideoCollaborator/);
});
