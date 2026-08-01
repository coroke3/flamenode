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
  assert.match(
    uploadBlock,
    /Promise\.allSettled\(\[env\.BUCKET\.delete\(stagingKey\), env\.BUCKET\.delete\(key\)\]\)/,
  );
  assert.match(uploadBlock, /tryDeleteUnreferencedIcon/);
  assert.match(uploadBlock, /runXIdPostCommit\([\s\S]*orphan_icon_cleanup/);
  assert.match(uploadBlock, /xicons\/staging\//);
});
