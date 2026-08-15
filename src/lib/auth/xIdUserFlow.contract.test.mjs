import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

test("X ID連携は初回・追加で同じ解析フローを使い、統合だけを設定に分離する", () => {
  const action = read("../actions/xid.ts");
  const component = read("../../components/settings/XIdSettingsClient.tsx");
  const settings = read("../../../app/(auth)/dashboard/settings/page.tsx");

  assert.match(action, /z\.enum\(\["link", "merge"\]\)/);
  assert.match(action, /parseXIdentityInput\(String\(formData\.get\("x_id"\)/);
  assert.doesNotMatch(action, /parsedKind\.data === "alias"/);
  assert.match(component, /X IDを連携/);
  assert.match(component, /parseXIdentityInput/);
  assert.doesNotMatch(component, /新規・既存を自動判定|別名を追加/);
  assert.match(component, /export function XIdMergeForm/);
  assert.match(settings, /<XIdMergeForm linkedXIds=\{mergeCandidates\}/);
  assert.match(settings, /eq\(linkReqTable\.requested_by_auth_user_id, user\.id\)/);
  assert.doesNotMatch(settings, /ne\(linkReqTable\.status, "approved"\)/);
  assert.match(settings, /updated_at: linkReqTable\.updated_at/);
  assert.match(settings, /<XIdentityRequestHistoryList rows=\{requestHistory\}/);
  assert.match(settings, /isOnboarding && requestHistory\.length > 0/);
  assert.match(settings, /申請履歴/);
  assert.doesNotMatch(settings, /新規連携|新しい X ID を連携|自動判定/);
  assert.match(settings, /初回・2件目以降とも同じ手順/);
});

test("設定の候補取得は表示中のActive X ID 1件へ限定する", () => {
  const settings = read("../../../app/(auth)/dashboard/settings/page.tsx");
  assert.match(settings, /if \(db && xTabSelected && activeXPanel\)/);
  assert.match(settings, /const \[iconCandidates, channelCandidates\] = await Promise\.all\(\[/);
  assert.match(settings, /getXIconCandidates\(\s*db,\s*activeXPanel\.id/);
  assert.match(settings, /getYoutubeChannelCandidates\(\s*db,\s*activeXPanel\.id/);
  assert.match(settings, /const xTabSelected = showUtilityTab == null && activeXPanel != null/);
  assert.doesNotMatch(
    settings,
    /for \(const x of xIds\)[\s\S]*getXIconCandidates\(/,
  );
  assert.doesNotMatch(
    settings,
    /for \(const x of xIds\)[\s\S]*getYoutubeChannelCandidates\(/,
  );
});

test("本人はpendingのX ID申請を取り下げできる", () => {
  const action = read("../actions/xid.ts");
  const history = read("../../components/settings/XIdLinkedList.tsx");

  assert.match(action, /export async function cancelXIdLinkRequest/);
  assert.match(action, /申請者本人がX ID申請を取り下げ/);
  assert.match(action, /eq\(xIdentityRequests\.requested_by_auth_user_id, authUserId\)/);
  assert.match(action, /eq\(xIdentityRequests\.status, "pending"\)/);
  assert.match(action, /expectedMutationChanges: \[1\]/);
  assert.match(action, /catch \(error\)[\s\S]*申請の取り下げに失敗しました/);
  assert.match(action, /status: "cancelled"/);
  assert.match(history, /cancelXIdLinkRequest/);
  assert.match(history, /取り下げる/);
  assert.match(history, /row\.status === "pending"/);
});

test("再生リスト同期状況は一般ダッシュボードへ公開せず運営・管理画面に限定する", () => {
  const layout = read("../../../app/(auth)/layout.tsx");
  const dashboard = read("../../../app/(auth)/dashboard/youtube-playlists/page.tsx");
  const manage = read("../../../app/(manage)/manage/events/[id]/youtube-playlist/page.tsx");
  const admin = read("../../../app/(admin)/admin/youtube-sync/playlists/page.tsx");

  assert.doesNotMatch(layout, /dashboard\/youtube-playlists|再生リスト同期状況/);
  assert.match(dashboard, /redirect\("\/dashboard"\)/);
  assert.match(dashboard, /redirect\("\/admin\/youtube-sync\/playlists"\)/);
  assert.match(manage, /canAccessManageEvent/);
  assert.match(manage, /同期状態/);
  assert.match(admin, /user\.role !== "admin"/);
});
