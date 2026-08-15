import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("./submitSlotVideo.ts", import.meta.url), "utf8");

test("submitSlotVideo は ID 単独取得後に relation と snapshot を先に検証する", () => {
  const fnStart = source.indexOf("export async function submitSlotVideo");
  const fnBody = source.slice(fnStart);
  const slotLoad = fnBody.indexOf('eq(slots.id, slotId)');
  const relationCheck = fnBody.indexOf("const slotRelation = resolveSlotViewerRelation");
  const snapshotCheck = fnBody.indexOf("validateActiveXSnapshot");
  const parseForm = fnBody.indexOf("parseVideoForm");
  const iconResolve = fnBody.indexOf("resolveVideoCreatorIcon");

  assert.ok(slotLoad >= 0);
  assert.ok(relationCheck > slotLoad, "relation 判定は slot 取得の後");
  assert.ok(snapshotCheck > relationCheck, "snapshot 検証は relation 判定の後");
  assert.ok(parseForm > snapshotCheck, "フォーム解析は snapshot 検証の後");
  assert.ok(iconResolve > snapshotCheck, "snapshot 検証は icon 解決より前");
});

test("submitSlotVideo は group を SQL フィルタせず identity で拒否する", () => {
  assert.match(source, /resolveSlotGroupIdentity/);
  assert.match(source, /canActAsSlotActor/);
  assert.doesNotMatch(source, /isNull\(slots\.x_user_id\)/);
  assert.match(source, /x_user_id: after\.x_user_id/);
  assert.match(source, /groupIdentity\.adoptNullRows/);
});

test("submitSlotVideo は account_other/none を漏洩しない一般メッセージで拒否する", () => {
  assert.match(
    source,
    /slotRelation === "account_other" \|\| slotRelation === "none"[\s\S]*?SLOT_SUBMIT_REJECT_MESSAGE/,
  );
});

test("submitSlotVideo は pending 提出で global list/search/users/user/random を enqueue しない", () => {
  assert.match(source, /const isPublicResubmit = existingVideo\?\.visibility_status === "public"/);
  assert.match(source, /topSlotStatsGlobalTarget\("video_submit", "normal"\)/);
  assert.match(source, /if \(isPublicResubmit\) \{[\s\S]*list_recent/);
  assert.match(source, /if \(isPublicResubmit\) \{[\s\S]*topVideoVisibilityTargets\("video_submit"\)/);
  assert.doesNotMatch(
    source,
    /rebuildTargets[\s\S]*list_recent[\s\S]*topSlotStatsGlobalTarget/,
  );
});

test("submitSlotVideo は rebuild enqueue の event 対象を上限件数に cap する", () => {
  assert.match(source, /MAX_SUBMIT_SLOT_REBUILD_EVENT_TARGETS = 5/);
  assert.match(
    source,
    /const rebuildEventIds = syncedEventIds\.slice\(0, MAX_SUBMIT_SLOT_REBUILD_EVENT_TARGETS\)/,
  );
  assert.match(source, /\.\.\.rebuildEventIds\.flatMap\(\(eventId\) => \[/);
  assert.match(source, /targetEventIds: syncedEventIds/);
});

test("submitSlotVideo は buildOpsChannelWebhookStatement を event target で呼ぶ", () => {
  assert.match(source, /buildOpsChannelWebhookStatement/);
  assert.match(source, /target:\s*"event"/);
});

test("submitSlotVideo は同期対象イベント全体のステージ回答項目を検証する", () => {
  const syncIndex = source.indexOf("syncedEventIds = await resolveVideoEventSyncTargetIds");
  const stageIndex = source.indexOf("getStagePermissionFieldsForEvents(db, syncedEventIds)");
  const customIndex = source.indexOf("validateCustomAnswersForEvents(db, formData, syncedEventIds)");
  assert.ok(syncIndex >= 0 && stageIndex > syncIndex);
  assert.ok(customIndex > stageIndex);
  assert.doesNotMatch(
    source.slice(0, syncIndex),
    /getStagePermissionFieldsForEvents\(db, \[slotRow\.event_id\]\)/,
  );
});

test("submitSlotVideo はステージ項目の読取失敗を保存前に返す", () => {
  assert.match(
    source,
    /try\s*\{\s*stageFields = await getStagePermissionFieldsForEvents\(db, syncedEventIds\)[\s\S]*?stage permission fields read rejected/,
  );
});
