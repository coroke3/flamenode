import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("uploadXIdIcon は連携確認・承認済みチェック・検証・失敗時削除・orphan cleanup を行う", () => {
  const source = read("./xid.ts");
  const uploadBlock = source.slice(source.indexOf("export async function uploadXIdIcon"));

  assert.match(uploadBlock, /getLinkedXUser\(db, xUserId, authUserId\)/);
  assert.match(uploadBlock, /requireApprovedForEdit\(row\)/);
  assert.match(uploadBlock, /validateIconImageUpload\(/);
  assert.match(uploadBlock, /let dbCommitted = false/);
  assert.match(uploadBlock, /if \(!dbCommitted\)/);
  assert.match(
    uploadBlock,
    /Promise\.allSettled\(\[env\.BUCKET\.delete\(stagingKey\), env\.BUCKET\.delete\(key\)\]\)/,
  );
  assert.match(uploadBlock, /tryDeleteUnreferencedIcon/);
  assert.match(uploadBlock, /runXIdPostCommit\([\s\S]*orphan_icon_cleanup/);
  assert.match(uploadBlock, /runXIdPostCommit\([\s\S]*static_rebuild_enqueue/);
  assert.match(uploadBlock, /xicons\/staging\//);
  assert.match(uploadBlock, /unstable_rethrow\(error\)/);
  assert.match(uploadBlock, /createTraceId\(\)/);
  assert.doesNotMatch(uploadBlock, /throw error/);
  assert.match(uploadBlock, /return \{ ok: false, message:/);
  // enqueue 失敗で正式キーを消さない（DB 成功後の catch で key 削除しない）
  assert.doesNotMatch(
    uploadBlock,
    /mutateWithAudit[\s\S]*enqueueAfterXUserPublicUpdate[\s\S]*catch[\s\S]*BUCKET\.delete\(key\)/,
  );
});

test("setXIdIcon は候補検証後に orphan cleanup を post-commit する", () => {
  const source = read("./xid.ts");
  const setBlock = source.slice(
    source.indexOf("export async function setXIdIcon"),
    source.indexOf("export async function uploadXIdIcon"),
  );
  assert.match(setBlock, /getXIconCandidates/);
  assert.match(setBlock, /requireApprovedForEdit\(row\)/);
  assert.match(setBlock, /tryDeleteUnreferencedIcon/);
  assert.match(setBlock, /runXIdPostCommit\([\s\S]*orphan_icon_cleanup/);
  assert.match(setBlock, /runXIdPostCommit\([\s\S]*static_rebuild_enqueue/);
});
