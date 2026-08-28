import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
const [hooks, xid, enqueue] = await Promise.all([
  readFile(new URL("./hooks.ts", import.meta.url), "utf8"),
  readFile(new URL("../actions/xid.ts", import.meta.url), "utf8"),
  readFile(new URL("./enqueue.ts", import.meta.url), "utf8"),
]);

const MAX_STATIC_REBUILD_BATCH_TARGETS = Number(
  enqueue.match(/MAX_STATIC_REBUILD_BATCH_TARGETS\s*=\s*(\d+)/)?.[1],
);

const MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS = Number(
  hooks.match(/MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS\s*=\s*(\d+)/)?.[1],
);
test("動画ステータス変更batchの最悪ケースはMAX_STATIC_REBUILD_BATCH_TARGETS以内", () => {
  assert.ok(Number.isFinite(MAX_STATIC_REBUILD_BATCH_TARGETS));
  assert.ok(Number.isFinite(MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS));
  const withoutCreator =
    1 + // video
    1 + // youtube_related_blocklist
    1 + // random_video_pool
    3 + // list_recent / list_popular / search_index
    4 + // top_recommended / top_latest / top_nostalgic / top_stats
    1 + // recommend_core
    MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS;
  const withCreator =
    1 + // video
    1 + // youtube_related_blocklist
    1 + // random_video_pool
    3 + // list targets
    1 + // user
    1 + // users_index
    4 + // top_recommended / top_latest / top_nostalgic / top_stats
    1 + // recommend_core
    MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS;
  const worstCase = Math.max(withoutCreator, withCreator);
  assert.equal(worstCase, 21);
  assert.ok(MAX_STATIC_REBUILD_BATCH_TARGETS >= 205);
  assert.ok(worstCase <= MAX_STATIC_REBUILD_BATCH_TARGETS);
  assert.ok(MAX_STATIC_REBUILD_BATCH_TARGETS > 16);
});
test("動画作成は常にtop section producerをenqueueし、creatorありならuser/users_indexも追加する", () => {
  const createFn = hooks.match(/export async function enqueueAfterVideoCreate[\s\S]*?^}/m)?.[0];
  assert.ok(createFn);
  assert.match(createFn, /topVideoVisibilityTargets\("video_create"\)/);
  assert.match(createFn, /usersIndexTarget\("video_create"\)/);
  const topIdx = createFn.indexOf('topVideoVisibilityTargets("video_create")');
  const creatorBranch = createFn.indexOf("if (opts.creatorXUserId)");
  assert.ok(topIdx >= 0 && creatorBranch > topIdx, "top section は creator 分岐より前");
});
test("buildVideoCardChangeFanOutTargetsは常にsection producerをenqueueする", () => {
  assert.match(hooks, /export function buildVideoCardChangeFanOutTargets[\s\S]*topVideoCardTargets\(opts\.reason/);
  assert.doesNotMatch(hooks, /skipTopRecommend/);
});
test("枠変更はevent_slotsとtop_slot_statsを同一batchでenqueueする", () => {
  assert.match(hooks, /export function buildSlotChangeQueueBatch/);
  assert.match(hooks, /targetType: "event_slots"/);
  assert.match(hooks, /topSlotStatsGlobalTarget\(opts\.reason/);
  assert.doesNotMatch(
    hooks,
    /buildSlotChangeQueueBatch[\s\S]*topGlobalTarget/,
  );
});
test("event visibility/update refreshes list projections that embed the event title", () => {
  const eventBatch = hooks.match(
    /export function buildEventChangeQueueBatch[\s\S]*?^}/m,
  )?.[0];
  assert.ok(eventBatch);
  assert.match(eventBatch, /targetType: "list_recent"/);
  assert.match(eventBatch, /targetType: "list_popular"/);
});
test("X ID公開プロフィール更新は user と users_index をenqueueする", () => {
  assert.match(hooks, /export async function enqueueAfterXUserPublicUpdate/);
  assert.match(hooks, /export function buildAfterXUserPublicUpdateQueueBatch/);
  assert.match(
    hooks,
    /enqueueAfterXUserPublicUpdate[\s\S]*targetType: "user"[\s\S]*usersIndexTarget\(opts\.reason\)/,
  );
  assert.match(hooks, /await enqueueStaticRebuildMany\(db, \[/);
});
test("本人X IDプロフィール・アイコン更新成功時に静的再生成フックを呼ぶ", () => {
  assert.match(xid, /buildAfterXUserPublicUpdateQueueBatch/);
  assert.match(
    xid,
    /updateXIdProfile[\s\S]*buildAfterXUserPublicUpdateQueueBatch\(db, \{[\s\S]*reason: "x_user_profile_update"/,
  );
  assert.match(
    xid,
    /setXIdIcon[\s\S]*buildAfterXUserPublicUpdateQueueBatch\(db, \{[\s\S]*reason: "x_user_icon_update"/,
  );
  assert.match(
    xid,
    /uploadXIdIcon[\s\S]*buildAfterXUserPublicUpdateQueueBatch\(db, \{[\s\S]*reason: "x_user_icon_update"/,
    );
  assert.equal(
    (xid.match(/const queue = await buildAfterXUserPublicUpdateQueueBatch\(/g) ?? []).length,
    3,
  );
});

test("member_suggestions再生成フックは必須mutationへ接続されている", async () => {
  const [merge, adminMembers, videoSavePlan, createFreeVideo, submitSlotVideo, collabPerms] =
    await Promise.all([
      readFile(new URL("../xid/merge.ts", import.meta.url), "utf8"),
      readFile(new URL("../actions/video/adminMembers.ts", import.meta.url), "utf8"),
      readFile(new URL("../video/videoSavePlan.ts", import.meta.url), "utf8"),
      readFile(new URL("../actions/video/createFreeVideo.ts", import.meta.url), "utf8"),
      readFile(new URL("../actions/video/submitSlotVideo.ts", import.meta.url), "utf8"),
      readFile(new URL("../actions/video-collab-perms.ts", import.meta.url), "utf8"),
    ]);
  // hooks側のhelperと各mutation site。
  assert.match(hooks, /export function memberSuggestionsTarget/);
  assert.match(hooks, /targetType: "member_suggestions"/);
  assert.match(merge, /targetType: "member_suggestions"/);
  assert.match(adminMembers, /"member_suggestions"/);
  assert.match(adminMembers, /targetType: "event_release"/);
  assert.match(videoSavePlan, /memberSuggestionsTarget\(/);
  assert.match(createFreeVideo, /"member_suggestions"/);
  assert.match(submitSlotVideo, /"member_suggestions"/);
  // 権限single/batch actionは同一atomic write内でindex再生成をenqueueする。
  assert.match(collabPerms, /async function applyPermissionIntentsToVideo[\s\S]*memberSuggestionsTarget\("video_permissions_batch"\)/);
  assert.match(collabPerms, /memberSuggestionsTarget\("video_permissions_batch"\)/);
  assert.match(collabPerms, /loadVideoRebuildEventIds/);
  assert.match(collabPerms, /targetType: "event_release"/);
});

test("member_suggestions targetIdは常にglobalでqueue dedupeに任せる", () => {
  const helper = hooks.match(
    /export function memberSuggestionsTarget[\s\S]*?^}/m,
  )?.[0];
  assert.ok(helper);
  assert.match(helper, /targetId: "global"/);
});
