import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("./interaction.ts", import.meta.url)),
  "utf8",
);

test("interaction保存はinteraction・like集計・queue・監査を単一batchへ渡す", () => {
  assert.equal((source.match(/mutateWithAudit\(db,/g) ?? []).length, 1);
  assert.match(source, /mutationStatements\.push\(\.\.\.queue\.statements\)/);
  assert.match(source, /expectedChanges\.push\(\.\.\.queue\.expectedChanges\)/);
  assert.match(source, /table_name: "video_interactions"/);
  assert.match(source, /table_name: "videos"/);
  assert.doesNotMatch(source, /adjustVideoAppLikeCount/);
});

test("interactionとvideos更新は読取snapshotをCAS条件に含める", () => {
  assert.match(source, /eq\(videoInteractions\.created_at, existing!\.created_at\)/);
  assert.match(source, /target\.visibility_status !== "public"/);
  assert.match(source, /interaction_target\.visibility_status = 'public'/);
  assert.match(source, /interaction_target\.updated_at = \$\{target\.updated_at\}/);
  assert.match(source, /eq\(videos\.visibility_status, "public"\)/);
  assert.match(source, /eq\(videos\.app_like_count, target\.app_like_count\)/);
  assert.match(source, /eq\(videos\.updated_at, target\.updated_at\)/);
  assert.match(source, /expectedMutationChanges: expectedChanges/);
});

test("toggleは認証・既存状態を二重読取せず同じ保存関数で反転する", () => {
  assert.match(source, /requestedState === "toggle" \? !existing : requestedState/);
  assert.match(source, /return mutateVideoInteraction\(formData, "toggle"\)/);
  assert.equal((source.match(/writeGuard\(/g) ?? []).length, 1);
});
