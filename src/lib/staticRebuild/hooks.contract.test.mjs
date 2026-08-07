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
    2 + // top / recommend_core
    MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS;
  const withCreator =
    1 + // video
    1 + // youtube_related_blocklist
    1 + // random_video_pool
    3 + // list targets
    1 + // user
    1 + // users_index
    MAX_VIDEO_STATUS_REBUILD_EVENT_TARGETS;
  const worstCase = Math.max(withoutCreator, withCreator);
  assert.equal(worstCase, MAX_STATIC_REBUILD_BATCH_TARGETS);
});

test("動画作成はusers_index経由でtop/recommendを間接enqueueする", () => {
  assert.match(hooks, /globalListTargets\("video_create"\)/);
  assert.match(hooks, /usersIndexTarget\("video_create"\)/);
  assert.doesNotMatch(
    hooks,
    /enqueueAfterVideoCreate[\s\S]*targetType: "top"/,
  );
});

test("枠変更はeventとtop_slot_statsを同一batchでenqueueする", () => {
  assert.match(hooks, /export function buildSlotChangeQueueBatch/);
  assert.match(hooks, /topSlotStatsGlobalTarget\(opts\.reason/);
  assert.doesNotMatch(
    hooks,
    /buildSlotChangeQueueBatch[\s\S]*topGlobalTarget/,
  );
});

test("X ID公開プロフィール更新は user と users_index をenqueueする", () => {
  assert.match(hooks, /export async function enqueueAfterXUserPublicUpdate/);
  assert.match(
    hooks,
    /enqueueAfterXUserPublicUpdate[\s\S]*targetType: "user"[\s\S]*usersIndexTarget\(opts\.reason\)/,
  );
  assert.match(hooks, /await enqueueStaticRebuildMany\(db, \[/);
});

test("本人X IDプロフィール・アイコン更新成功時に静的再生成フックを呼ぶ", () => {
  assert.match(xid, /enqueueAfterXUserPublicUpdate/);
  assert.match(
    xid,
    /updateXIdProfile[\s\S]*enqueueAfterXUserPublicUpdate\(db, \{[\s\S]*reason: "x_user_profile_update"/,
  );
  assert.match(
    xid,
    /setXIdIcon[\s\S]*enqueueAfterXUserPublicUpdate\(db, \{[\s\S]*reason: "x_user_icon_update"/,
  );
  assert.match(
    xid,
    /uploadXIdIcon[\s\S]*enqueueAfterXUserPublicUpdate\(db, \{[\s\S]*reason: "x_user_icon_update"/,
  );
  assert.equal(
    (xid.match(/await enqueueAfterXUserPublicUpdate\(/g) ?? []).length,
    3,
  );
});
