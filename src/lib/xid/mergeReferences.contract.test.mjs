import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./merge.ts", import.meta.url), "utf8");

test("X ID統合は予約主体の全表記と連続枠グループを統合先へ揃える", () => {
  assert.match(source, /slotReservationGroups/);
  assert.match(source, /lower\(trim\(ltrim\(trim\(\$\{slots\.reserved_x_id_snapshot\}\), '@'\)\)\)/);
  assert.match(source, /UPDATE slots[\s\S]*reserved_x_id_snapshot[\s\S]*version = version \+ 1/);
  assert.match(source, /UPDATE slot_reservation_groups SET x_user_id = \$\{target\}/);
  assert.match(source, /slot_reservation_groups\?\.length/);
  assert.match(source, /SELECT video_id FROM slots[\s\S]*reserved_x_id_snapshot/);
});

test("X ID統合はメンバー以外の運営参照も更新し、差し戻し情報を保持する", () => {
  assert.match(source, /videoModerationCases/);
  assert.match(source, /UPDATE video_moderation_cases SET related_x_user_id = \$\{target\}/);
  assert.match(source, /video_moderation_cases\?\.length/);
  assert.match(source, /reserved_x_id_snapshot = \([\s\S]*json_each\(\$\{snapshotJson\}, '\$\.slots'\)/);
  assert.match(source, /SET approval_status = 'rejected'/);
  assert.match(source, /approval_status IS \$\{snapshot\.target_x_user\.approval_status\}/);
  assert.match(source, /INSERT OR IGNORE INTO x_user_aliases/);
});

test("X ID統合は更新後に統合元の現行参照が残っていないことを確認してから完了する", () => {
  assert.match(source, /function noActiveSourceReferencesSql/);
  for (const table of [
    '"user"',
    "videos",
    "video_members",
    "video_chapters",
    "slots",
    "slot_reservation_groups",
    "video_moderation_cases",
    "video_interactions",
    "event_staff",
    "x_user_account_links",
    "x_user_aliases",
  ]) {
    assert.match(
      source,
      new RegExp(`NOT EXISTS \\(SELECT 1 FROM ${table} WHERE`),
      `統合元の現行参照検査に ${table} が含まれていません`,
    );
  }
  assert.match(
    source,
    /UPDATE x_identity_requests[\s\S]*AND \$\{noActiveSourceReferencesSql\(source\)\}/,
  );
});

test("影響確認は作品単位の対象と変更内訳をbounded queryで返す", async () => {
  const impact = await readFile(
    new URL("../admin/xIdMergeImpact.ts", import.meta.url),
    "utf8",
  );
  assert.match(impact, /export async function fetchXIdMergePreview/);
  assert.match(impact, /affected_video_ids/);
  assert.match(impact, /Number\.isFinite\(limit\)/);
  assert.match(impact, /const requestedLimit/);
  assert.match(impact, /LIMIT \$\{boundedLimit\}/);
  assert.match(impact, /member_rows/);
  assert.match(impact, /chapter_rows/);
  assert.match(impact, /slot_rows/);
  assert.match(impact, /interaction_rows/);
  assert.match(impact, /moderation_rows/);
});

test("X ID統合は表記揺れを同一名義として自己統合を拒否する", () => {
  assert.match(source, /normalizeXId\(request\.source_x_user_id\)/);
  assert.match(source, /normalizeXId\(request\.target_x_user_id\)/);
});
