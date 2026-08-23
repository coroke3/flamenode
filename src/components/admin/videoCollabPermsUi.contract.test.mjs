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

test("共同編集権限UIはDiscord Snowflake直接入力ではなくX IDを正本にする", () => {
  assert.match(managerSource, /編集権限は X ID に付与されます/);
  assert.match(managerSource, /placeholder="X ID \(@ なし・必須\)"/);
  assert.doesNotMatch(managerSource, /placeholder="Discord User ID/);
  assert.match(managerSource, /const canSubmit = name\.trim\(\)\.length > 0 && xUserId\.trim\(\)\.length > 0/);
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

test("実際の合作所有者判定もcan_edit=1と承認済みX IDの両方を要求する", () => {
  assert.match(ownershipSource, /eq\(videoMembers\.can_edit, 1\)/);
  assert.match(ownershipSource, /approvedXIdsWhere\(videoMembers\.x_user_id/);
  assert.match(ownershipSource, /hasCollaboratorEdit = rows\.length > 0/);
});
