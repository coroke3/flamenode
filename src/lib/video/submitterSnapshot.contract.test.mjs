import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

test("ensureSubmissionXUser は削除され作品保存から呼ばれない", () => {
  assert.equal(existsSync(path.join(root, "src/lib/video/ensureSubmissionXUser.ts")), false);
  for (const file of [
    "src/lib/actions/video/createFreeVideo.ts",
    "src/lib/actions/video/submitSlotVideo.ts",
    "src/lib/video/videoSavePlan.ts",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /buildSubmissionXUserPlan|ensureSubmissionXUser/);
    assert.match(source, /creator_profile_text/);
    assert.match(source, /creator_other_social_links/);
  }
});

test("作品表示の displayExpr は x_users フォールバックしない", () => {
  const source = read("src/lib/db/displayExpr.ts");
  assert.match(source, /creator_display_name/);
  assert.match(source, /creator_icon_url/);
  assert.doesNotMatch(source, /x_users\.icon_url|xUsers\.icon_url/);
  assert.doesNotMatch(source, /LEFT JOIN.*x_users|from\(xUsers\)/i);
});

test("resolveXUserIcon は過去作品へフォールバックしない", () => {
  const source = read("src/lib/db/xIconResolution.ts");
  const fnStart = source.indexOf("export async function resolveXUserIcon");
  const fnEnd = source.indexOf("export async function", fnStart + 1);
  const block = source.slice(fnStart, fnEnd > 0 ? fnEnd : undefined);
  assert.doesNotMatch(block, /videos\.creator_icon_url|from\(videos\)/);
});

test("migration 0046 がプロフィール列とバックフィルを含む", () => {
  const sql = read("migrations/0046_video_creator_profile_snapshot.sql");
  assert.match(sql, /creator_profile_text/);
  assert.match(sql, /creator_other_social_links/);
  assert.match(sql, /UPDATE videos/);
  assert.match(sql, /profile_text/);
});

test("degraded event list SQL は作品スナップショットのみを返す", () => {
  const source = read("src/lib/publicData/degradedEventListPageSql.ts");
  assert.match(source, /creator_display_name/);
  assert.match(source, /creator_icon_url/);
  assert.doesNotMatch(source, /x_users|xu\.x_name|xu\.icon_url/i);
});

test("updateVideo は identity 権限で profile / SNS / YouTube を検証する", () => {
  const source = read("src/lib/actions/video/updateVideo.ts");
  assert.match(source, /creator_profile_text/);
  assert.match(source, /creator_other_social_links/);
  assert.match(source, /creator_youtube_channel_url/);
  assert.match(source, /submitter_profile_action/);
  assert.doesNotMatch(source, /buildSubmissionXUserPlan|ensureSubmissionXUser/);
});
test("編集ページ初期値は video.creator_* を使い x_users フォールバックしない", () => {
  const source = read("app/(auth)/dashboard/edit/[id]/page.tsx");
  assert.match(source, /creator_profile_text|creator_other_social_links/);
  assert.match(source, /defaultProfile/);
  // 初期値ブロックで xRow.profile_text を直接使わない（再適用用は defaultProfile）
  assert.doesNotMatch(
    source,
    /display_name:\s*video\.creator_display_name[\s\S]{0,200}xRow\.x_name/,
  );
});
