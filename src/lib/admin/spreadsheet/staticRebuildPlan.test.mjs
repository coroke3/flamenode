import assert from "node:assert/strict";
import { test } from "node:test";

import {
  planSpreadsheetStaticRebuildTargets,
  SPREADSHEET_STATIC_REBUILD_SPLIT_REQUIRED,
} from "./staticRebuildPlan.ts";
import { spreadsheetHttpStatus } from "./errors.ts";

function mutation(table, operation, before, after, actorUserId = "admin-1") {
  return { table, operation, before, after, actorUserId };
}

function keys(targets) {
  return targets.map((target) => `${target.targetType}:${target.targetId}`);
}

test("eventsの編集はイベント詳細・枠・公開一覧を再生成する", () => {
  assert.deepEqual(
    keys(
      planSpreadsheetStaticRebuildTargets([
        mutation("events", "UPDATE", { id: "event-1", title: "旧" }, { id: "event-1", title: "新" }),
      ]),
    ),
    [
      "event_base:event-1",
      "event_slots:event-1",
      "events_index:global",
      "search_index:global",
      "top_events:global",
      "top_stats:global",
      "top_slot_stats:global",
    ],
  );
});

test("event_groupsの編集はイベント一覧を再生成する", () => {
  assert.deepEqual(
    keys(
      planSpreadsheetStaticRebuildTargets([
        mutation("event_groups", "UPDATE", { id: "group-1", name: "旧" }, { id: "group-1", name: "新" }),
      ]),
    ),
    ["events_index:global"],
  );
});

test("videosは詳細を常に再生成し、カード・visibilityの意味ある変更だけglobalへ波及する", () => {
  assert.deepEqual(
    keys(
      planSpreadsheetStaticRebuildTargets([
        mutation("videos", "CREATE", null, {
          id: "video-1",
          title: "作品",
          visibility_status: "public",
        }),
      ]),
    ),
    [
      "video:video-1",
      "random_video_pool:global",
      "list_recent:global",
      "list_popular:global",
      "search_index:global",
      "top_recommended:global",
      "top_latest:global",
      "top_nostalgic:global",
      "recommend_core:global",
      "youtube_related_blocklist:global",
    ],
  );

  assert.deepEqual(
    keys(
      planSpreadsheetStaticRebuildTargets([
        mutation(
          "videos",
          "UPDATE",
          { id: "video-1", title: "旧", intro_comment: "変更前" },
          { id: "video-1", title: "新", intro_comment: "変更前" },
        ),
      ]),
    ),
    [
      "video:video-1",
      "random_video_pool:global",
      "list_recent:global",
      "list_popular:global",
      "search_index:global",
      "top_recommended:global",
      "top_latest:global",
      "top_nostalgic:global",
      "recommend_core:global",
    ],
  );

  assert.deepEqual(
    keys(
      planSpreadsheetStaticRebuildTargets([
        mutation(
          "videos",
          "UPDATE",
          { id: "video-1", title: "作品", intro_comment: "変更前" },
          { id: "video-1", title: "作品", intro_comment: "変更後" },
        ),
      ]),
    ),
    ["video:video-1"],
  );

  assert.deepEqual(
    keys(
      planSpreadsheetStaticRebuildTargets([
        mutation(
          "videos",
          "UPDATE",
          { id: "video-1", title: "旧", visibility_status: "private" },
          { id: "video-1", title: "新", visibility_status: "public" },
        ),
      ]),
    ),
    [
      "video:video-1",
      "random_video_pool:global",
      "list_recent:global",
      "list_popular:global",
      "search_index:global",
      "top_recommended:global",
      "top_latest:global",
      "top_nostalgic:global",
      "recommend_core:global",
      "youtube_related_blocklist:global",
    ],
  );
});

test("YouTube status・event・member・chapterのmappingをdedupeする", () => {
  const targets = planSpreadsheetStaticRebuildTargets([
    mutation(
      "video_youtube_metadata",
      "UPDATE",
      {
        video_id: "video-1",
        youtube_privacy_status: "public",
        youtube_availability_status: "available",
        view_count: 1,
      },
      {
        video_id: "video-1",
        youtube_privacy_status: "private",
        youtube_availability_status: "available",
        view_count: 2,
      },
    ),
    mutation("video_events", "CREATE", null, {
      video_id: "video-1",
      event_id: "event-1",
    }),
    mutation(
      "video_members",
      "UPDATE",
      {
        id: "member-1",
        video_id: "video-1",
        name: "旧名",
      },
      {
        id: "member-1",
        video_id: "video-1",
        name: "新名",
      },
    ),
    mutation(
      "video_chapters",
      "DELETE",
      {
        id: "chapter-1",
        video_id: "video-2",
      },
      null,
    ),
  ]);

  assert.deepEqual(keys(targets), [
    "video:video-1",
    "youtube_related_blocklist:global",
    "random_video_pool:global",
    "users_index:global",
    "video:video-2",
  ]);
});

test("YouTubeのview数だけの更新はglobalを再生成しない", () => {
  const targets = planSpreadsheetStaticRebuildTargets([
    mutation(
      "video_youtube_metadata",
      "UPDATE",
      {
        video_id: "video-1",
        youtube_privacy_status: "public",
        youtube_availability_status: "available",
        view_count: 1,
      },
      {
        video_id: "video-1",
        youtube_privacy_status: "public",
        youtube_availability_status: "available",
        view_count: 2,
      },
    ),
  ]);
  assert.deepEqual(keys(targets), ["video:video-1"]);
});

test("video_eventsの付け替えは旧・新videoとrandom poolをすべて再生成する", () => {
  const targets = planSpreadsheetStaticRebuildTargets([
    mutation(
      "video_events",
      "UPDATE",
      { video_id: "video-old", event_id: "event-old" },
      { video_id: "video-new", event_id: "event-new" },
    ),
  ]);
  assert.deepEqual(keys(targets), [
    "video:video-old",
    "video:video-new",
    "random_video_pool:global",
  ]);
});

test("video_membersはvideoとusers_indexを再生成する", () => {
  const targets = planSpreadsheetStaticRebuildTargets([
    mutation("video_members", "UPDATE", { video_id: "video-1" }, { video_id: "video-1" }),
  ]);
  assert.deepEqual(keys(targets), ["video:video-1", "users_index:global"]);
});

test("x_usersは個別userと共有icon mapを含むusers_indexを再生成する", () => {
  const targets = planSpreadsheetStaticRebuildTargets([
    mutation(
      "x_users",
      "UPDATE",
      { id: "x-1", icon_url: "old" },
      {
        id: "x-1",
        icon_url: "new",
      },
    ),
  ]);
  assert.deepEqual(keys(targets), ["user:x-1", "users_index:global"]);
  assert.equal(targets[0].requestedByUserId, "admin-1");
});

test("16 targetを超えるplanner入力はapplyせず分割を要求する", () => {
  assert.throws(
    () =>
      planSpreadsheetStaticRebuildTargets(
        Array.from({ length: 17 }, (_, index) =>
          mutation("video_members", "CREATE", null, {
            id: `member-${index}`,
            video_id: `video-${index}`,
          }),
        ),
      ),
    new RegExp(SPREADSHEET_STATIC_REBUILD_SPLIT_REQUIRED),
  );
  assert.equal(
    spreadsheetHttpStatus(SPREADSHEET_STATIC_REBUILD_SPLIT_REQUIRED),
    400,
  );
});
