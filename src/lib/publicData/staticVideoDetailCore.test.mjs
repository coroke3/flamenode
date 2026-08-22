import { test } from "node:test";
import assert from "node:assert/strict";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const { normalizeStaticVideoDetail } = await import(
    "./staticVideoDetailCore.ts"
  );

  test("normalizeStaticVideoDetail: normalizes video and members", () => {
    const detail = normalizeStaticVideoDetail({
      generated_at: 100,
      video: {
        id: "video1",
        title: "Video 1",
        youtube_video_id: "abcdefghijk",
        creator_display_name: "Creator",
        visibility_status: "public",
      },
      event_ids: ["event1", ""],
      public_members: [
        {
          id: "member1",
          display_name: "Member",
          x_user_id: "member",
          order_index: 1,
        },
      ],
    });

    assert.ok(detail);
    assert.equal(detail.video.id, "video1");
    assert.deepEqual(detail.eventIds, ["event1"]);
    assert.equal(detail.publicMembers[0].display_name, "Member");
    assert.equal(detail.appLikeCount, 0);
    assert.deepEqual(detail.softwareLabels, []);
    assert.deepEqual(detail.publicChapters, []);
    assert.deepEqual(detail.memberChapters, []);
    assert.deepEqual(detail.publicEvents, []);
    assert.deepEqual(detail.relatedVideos, []);
  });

  test("normalizeStaticVideoDetail: normalizes extended public payload", () => {
    const detail = normalizeStaticVideoDetail({
      generated_at: 200,
      app_like_count: 12,
      software_labels: ["After Effects", "Premiere Pro"],
      video: {
        id: "video1",
        title: "Video 1",
        creator_x_user_id: "creator",
        creator_display_name: "Creator",
        creator_youtube_channel_url: "https://youtube.com/@creator",
        creator_profile_text: "Profile",
        creator_other_social_links: "[]",
        music_reference_url: "https://example.com/music",
        visibility_status: "public",
      },
      event_ids: ["event1"],
      public_events: [
        {
          id: "event1",
          title: "Event 1",
          visibility_status: "public",
          accent_color: "#ff0000",
        },
      ],
      public_chapters: [
        {
          id: "ch1",
          chapter_time: 30,
          chapter_label: "Intro",
          author_name: "Creator",
        },
      ],
      member_chapters: [
        {
          id: "vm1:member:0",
          video_member_id: "vm1",
          chapter_time: 60,
          chapter_label: "担当",
        },
      ],
      related_videos: [
        {
          id: "video2",
          title: "Related",
          display_name: "Other",
        },
      ],
    });

    assert.ok(detail);
    assert.equal(detail.appLikeCount, 12);
    assert.deepEqual(detail.softwareLabels, ["After Effects", "Premiere Pro"]);
    assert.equal(detail.video.creator_x_user_id, "creator");
    assert.equal(detail.video.music_reference_url, "https://example.com/music");
    assert.equal(detail.video.creator_youtube_channel_url, "https://youtube.com/@creator");
    assert.equal(detail.video.creator_profile_text, "Profile");
    assert.equal(detail.video.creator_other_social_links, "[]");
    assert.equal(detail.publicEvents[0].title, "Event 1");
    assert.equal(detail.publicChapters[0].chapter_label, "Intro");
    assert.equal(detail.memberChapters[0].video_member_id, "vm1");
    assert.equal(detail.relatedVideos[0].display_name, "Other");
  });

  test("normalizeStaticVideoDetail: accepts a public video without a YouTube ID", () => {
    const detail = normalizeStaticVideoDetail({
      video: {
        id: "video-no-youtube",
        title: "作品情報のみ",
        youtube_video_id: null,
        creator_display_name: "Creator",
        intro_comment: "作品の説明",
        visibility_status: "public",
      },
    });

    assert.ok(detail);
    assert.equal(detail.video.youtube_video_id, null);
    assert.equal(detail.video.intro_comment, "作品の説明");
  });

  test("normalizeStaticVideoDetail: rejects payload without video title", () => {
    assert.equal(normalizeStaticVideoDetail({ video: { id: "video1" } }), null);
  });

  test("normalizeStaticVideoDetail: rejects private artifacts", () => {
    assert.equal(
      normalizeStaticVideoDetail({
        video: { id: "private", title: "Private", visibility_status: "private" },
      }),
      null,
    );
  });
}
