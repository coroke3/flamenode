import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./securityChecks.ts", import.meta.url), "utf8");

test("security diagnostics describe the submitter and linked-X evidence actually queried", () => {
  assert.match(source, /BANされた投稿者が登録した作品/);
  assert.match(source, /TOS未同意の投稿者が登録した作品/);
  assert.match(source, /submitted_by_user_id: videosTable\.submitted_by_user_id/);
  assert.match(source, /submitter:\$\{r\.submitted_by_user_id\}/);
  assert.match(source, /BANユーザーにも紐づくX IDのチャプターコメント/);
  assert.match(source, /実際の投稿者を特定できる列はありません/);
  assert.doesNotMatch(source, /BAN ユーザーが owner の作品/);
  assert.doesNotMatch(source, /owner:\$\{r\.owner\}/);
  assert.doesNotMatch(source, /writeGuard 漏れの可能性/);
});
