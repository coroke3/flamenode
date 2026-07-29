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
    nostalgic: [
      {
        id: "v-old",
        title: "Archive",
        display_name: "Archive Creator",
        creator_x_user_id: "archive_creator",
      },
    ],
    active_events: [
      {
        id: "event-1",
        title: "Event",
        visibility_status: "public",
        start_time: 200,
        end_time: 300,
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
    stats: { public_videos: 12, active_events: 1, creators: 4, public_events: 7 },
  });

  assert.ok(top);
  assert.equal(top.generatedAt, 123);
  assert.equal(top.recommended[0].display_name, "Creator");
  assert.equal(top.latest[0].title, "Latest");
  assert.equal(top.nostalgic[0].title, "Archive");
  assert.equal(top.nostalgic[0].creator_x_user_id, "archive_creator");
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
    publicEvents: 7,
  });
});

test("normalizeStaticTop: 新着100件と懐かしの映像20件を上限にする", () => {
  const top = normalizeStaticTop({
    latest: Array.from({ length: 120 }, (_, index) => ({
      id: `latest-${index}`,
      title: `Latest ${index}`,
      display_name: "Creator",
    })),
    nostalgic: Array.from({ length: 30 }, (_, index) => ({
      id: `old-${index}`,
      title: `Old ${index}`,
      display_name: "Creator",
    })),
  });

  assert.ok(top);
  assert.equal(top.latest.length, 100);
  assert.equal(top.nostalgic.length, 20);
});

test("normalizeStaticTop: legacy items だけでも表示可能にする", () => {
  const top = normalizeStaticTop({
    items: [{ id: "v1", title: "Video", display_name: "Creator" }],
  });

  assert.ok(top);
  assert.equal(top.recommended.length, 1);
  assert.equal(top.latest.length, 1);
});

test("normalizeStaticTop filters point events from card lists", () => {
  const top = normalizeStaticTop({
    active_events: [
      {
        id: "point",
        title: "Point",
        visibility_status: "public",
        start_time: 200,
      },
      {
        id: "bounded",
        title: "Bounded",
        visibility_status: "public",
        start_time: 200,
        end_time: 300,
      },
    ],
    latest_events: [
      {
        id: "point-latest",
        title: "Point Latest",
        visibility_status: "public",
        end_time: 400,
      },
    ],
  });

  assert.ok(top);
  assert.deepEqual(top.activeEvents.map((event) => event.id), ["bounded"]);
  assert.equal(top.latestEvents.length, 0);
});

test("normalizeStaticTop: 空 payload は miss 扱いにする", () => {
  assert.equal(normalizeStaticTop({ items: [] }), null);
});
