import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) =>
  readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

test("TSV merge/replaceはどちらもpermission intentを確認してからmember stateへ適用する", async () => {
  const source = await read("src/components/forms/VideoMembersField.tsx");
  assert.match(
    source,
    /pendingApplyRef\.current = \(\) => finishApply\(mode, bulkPreview\.members\)/,
  );
  assert.match(
    source,
    /mode === "replace"[\s\S]*setReplaceConfirmOpen\(true\)[\s\S]*bulkPreview\.permissionIntents\.length > 0[\s\S]*setPermConfirmOpen\(true\)/,
  );
  assert.doesNotMatch(
    source,
    /finishApply\("merge", bulkPreview\.members\)/,
  );
  assert.match(
    source,
    /if \(result\.ok\) \{[\s\S]*runPendingApply\(\)/,
  );
});

test("参加者管理ページはhidden editorを除外しmanaged chapterを初期値へ戻す", async () => {
  const source = await read("app/(admin)/admin/videos/[id]/members/page.tsx");
  assert.match(source, /eq\(videoMembers\.is_public_member, 1\)/);
  assert.match(source, /FROM json_each\(\$\{JSON\.stringify\(memberIds\)\}\)/);
  assert.match(source, /extractVideoMemberIdFromChapterId/);
  assert.match(source, /formatMemberChapterTime/);
  assert.match(source, /chapters:\s*\(chaptersByMemberId\.get\(member\.id\)/);
});

test("参加者保存はD1等の失敗を一律に競合と断定せずbudget errorを分離する", async () => {
  const source = await read("src/lib/actions/video/adminMembers.ts");
  assert.match(source, /VideoAtomicPlanBudgetError/);
  assert.match(source, /traceId/);
  assert.match(source, /参加者設定が一度に処理できる上限を超えています/);
  assert.match(source, /参加者設定の保存に失敗しました。最新状態を確認して再試行してください/);
  assert.doesNotMatch(source, /保存が競合しました。再読み込みして再試行してください/);
});

test("参加者保存はvideos全行CASを使わずmember-set CASを競合正本にする", async () => {
  const adminSource = await read("src/lib/actions/video/adminMembers.ts");
  const memberPlanSource = await read("src/lib/video/replaceVideoMembers.ts");
  assert.doesNotMatch(adminSource, /expectedRowCondition/);
  assert.match(adminSource, /\.where\(eq\(videos\.id, videoId\)\)/);
  assert.match(adminSource, /member-set CAS/);
  assert.match(memberPlanSource, /buildVideoMemberSetGuardSql/);
  assert.match(memberPlanSource, /plan\.expectedChanges\.push\(null\)/);
});

test("user詳細の作品カードは作品snapshot iconをcurrent X iconより優先する", async () => {
  const source = await read("app/(public)/user/[id]/page.tsx");
  const projection = source.match(
    /function projectVideoCardIcons\([\s\S]*?\n}/,
  )?.[0];
  assert.ok(projection);
  const snapshotIndex = projection.indexOf("normalizePublicIconUrl(video.icon_url)");
  const projectedIndex = projection.indexOf("resolveProjectedIcon");
  assert.ok(snapshotIndex >= 0);
  assert.ok(projectedIndex > snapshotIndex);
  assert.match(projection, /legacyIconUrl: null/);

  const profileSection = source.match(
    /const profileIcon = cachedGoogleImageUrl\([\s\S]*?\);/,
  )?.[0];
  assert.ok(profileSection);
  assert.match(profileSection, /normalizePublicIconUrl\(user\.icon_url\)/);
  assert.match(profileSection, /xUserId: user\.id/);
});
