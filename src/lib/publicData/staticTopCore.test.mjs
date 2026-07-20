import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStaticTop } from "./staticTopCore.ts";

test("normalizeStaticTop: top payload をトップページ用 DTO に整形する", () => {
  const top = normalizeStaticTop({
    generated_at: 123,
    recommended: [
      {
        id: "v1",
        title: "Video",
        youtube_video_id: "abcdefghijk",
        creator_display_name: "Creator",
      },
    ],
    latest: [
      {
        id: "v2",
        title: "Latest",
        display_name: "Latest Creator",
      },
    ],
    active_events: [
      {
        id: "event-1",
        title: "Event",
        visibility_status: "public",
        start_time: 200,
      },
    ],
    latest_events: [
      {
        id: "event-2",
        title: "Archive",
        visibility_status: "public",
      },
    ],
    creators: [
      {
        id: "creator",
        x_name: "Creator",
        video_count: 2,
        collab_count: 1,
      },
    ],
    announcements: [
      {
        id: "a1",
        title: "Notice",
        body: "Body",
        severity: "info",
      },
    ],
    slot_stats: [{ event_id: "event-1", available: 3, total: 5 }],
    event_video_counts: [{ event_id: "event-2", count: 9 }],
    stats: { public_videos: 12, active_events: 1, creators: 4 },
  });

  assert.ok(top);
  assert.equal(top.generatedAt, 123);
  assert.equal(top.recommended[0].display_name, "Creator");
  assert.equal(top.latest[0].title, "Latest");
  assert.equal(top.activeEvents[0].id, "event-1");
  assert.equal(top.latestEvents[0].visibility_status, "public");
  assert.equal(top.creators[0].video_count, 2);
  assert.equal(top.announcements[0].severity, "info");
  assert.deepEqual(top.topSlotStats.get("event-1"), { available: 3, total: 5 });
  assert.equal(top.eventVideoCounts["event-2"], 9);
  assert.deepEqual(top.stats, {
    publicVideos: 12,
    activeEvents: 1,
    creators: 4,
  });
});

test("normalizeStaticTop: legacy items だけでも表示可能にする", () => {
  const top = normalizeStaticTop({
    items: [{ id: "v1", title: "Video", display_name: "Creator" }],
  });

  assert.ok(top);
  assert.equal(top.recommended.length, 1);
  assert.equal(top.latest.length, 1);
});

test("normalizeStaticTop: 空 payload は miss 扱いにする", () => {
  assert.equal(normalizeStaticTop({ items: [] }), null);
});
