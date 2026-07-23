import { test } from "node:test";
import assert from "node:assert/strict";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { normalizeStaticEventDetail } = await import(
    "./staticEventDetailCore.ts"
  );

  test("normalizeStaticEventDetail: event detail payload is shaped for static view", () => {
    const detail = normalizeStaticEventDetail({
      generated_at: 100,
      event: {
        id: "event1",
        title: "Event 1",
        explanation: "About",
        visibility_status: "public",
        start_time: 200,
        slot_part_gap_minutes: 15,
        slot_visibility_mode: "public_name",
      },
      public_staff: [
        {
          role: "representative",
          display_name: "Staff",
          x_user_id: "staff",
          x_name: "Staff Name",
        },
      ],
      slots_summary: [
        { status: "available", c: 2 },
        { status: "submitted", c: 3 },
      ],
      slots: [
        { id: "slot-1", status: "available", start_time: 100, sort_order: 0 },
        { id: "slot-2", status: "submitted", start_time: 200, sort_order: 1 },
      ],
      public_videos: [
        {
          id: "video1",
          title: "Video 1",
          youtube_video_id: "abcdefghijk",
          creator_display_name: "Creator",
          creator_x_user_id: "creator",
          visibility_status: "public",
        },
      ],
      video_total: 12,
      creator_count: 4,
    });

    assert.ok(detail);
    assert.equal(detail.generatedAt, 100);
    assert.equal(detail.event.id, "event1");
    assert.equal(detail.event.slot_part_gap_minutes, 15);
    assert.equal(detail.publicStaff.length, 1);
    assert.equal(detail.slotSummary[1].count, 3);
    assert.equal(detail.slots.length, 2);
    assert.equal(detail.publicVideos[0].creator_display_name, "Creator");
    assert.equal(detail.publicVideos[0].creator_x_user_id, "creator");
    assert.equal(detail.videoTotal, 12);
    assert.equal(detail.creatorCount, 4);
  });

  test("normalizeStaticEventDetail: rejects payload without event id", () => {
    assert.equal(
      normalizeStaticEventDetail({ event: { title: "Missing id" } }),
      null,
    );
  });

  test("normalizeStaticEventDetail: drops non-public event and video rows", () => {
    assert.equal(
      normalizeStaticEventDetail({
        event: { id: "private-event", title: "Private", visibility_status: "private" },
      }),
      null,
    );
    const detail = normalizeStaticEventDetail({
      event: { id: "event1", title: "Event", visibility_status: "public" },
      public_videos: [
        { id: "private-video", title: "Private", visibility_status: "private" },
      ],
    });
    assert.ok(detail);
    assert.equal(detail.publicVideos.length, 0);
  });
}
