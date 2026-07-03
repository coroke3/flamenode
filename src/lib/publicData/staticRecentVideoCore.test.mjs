import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeStaticRecentVideoPage } from "./staticRecentVideoCore.ts";

test("normalizeStaticRecentVideoPage: R2 recent payload を一覧カード用に整形する", () => {
  const page = normalizeStaticRecentVideoPage(
    {
      generated_at: 100,
      total: 2,
      items: [
        {
          id: "v1",
          title: "Video 1",
          youtube_video_id: "abcdefghijk",
          creator_display_name: "Creator",
          creator_icon_url: "https://example.com/icon.png",
          creator_x_user_id: "creator",
          primary_event_id: "event1",
          scheduled_time: 90,
        },
      ],
    },
    1,
    24,
  );

  assert.ok(page);
  assert.equal(page.total, 2);
  assert.equal(page.generatedAt, 100);
  assert.deepEqual(page.videos[0], {
    id: "v1",
    title: "Video 1",
    youtube_video_id: "abcdefghijk",
    display_name: "Creator",
    icon_url: "https://example.com/icon.png",
    creator_x_user_id: "creator",
    primary_event_id: "event1",
    scheduled_time: 90,
    status: "public",
    part: null,
  });
});

test("normalizeStaticRecentVideoPage: 取得済み範囲外かつ total が多い場合は fallback", () => {
  const page = normalizeStaticRecentVideoPage(
    {
      total: 120,
      items: Array.from({ length: 24 }, (_, i) => ({
        id: `v${i}`,
        title: `Video ${i}`,
      })),
    },
    2,
    24,
  );
  assert.equal(page, null);
});

test("normalizeStaticRecentVideoPage: 壊れた行を落として残りを返す", () => {
  const page = normalizeStaticRecentVideoPage(
    {
      items: [
        { id: "missing-title" },
        { title: "missing-id" },
        { id: "ok", title: "OK", display_name: "Name" },
      ],
    },
    1,
    10,
  );

  assert.ok(page);
  assert.equal(page.total, 1);
  assert.equal(page.videos.length, 1);
  assert.equal(page.videos[0].id, "ok");
});
