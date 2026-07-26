import { test } from "node:test";
import assert from "node:assert/strict";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const {
    buildPublicVideoViewModelFromDatabase,
    buildPublicVideoViewModelFromStatic,
  } = await import("./publicVideoDetailViewModel.ts");

  const staticDetail = {
    schemaVersion: 1,
    generatedAt: 100,
    video: {
      id: "video1",
      title: "Video 1",
      creator_x_user_id: "creator",
      youtube_video_id: "yt1",
      creator_display_name: "Creator",
      creator_icon_url: null,
      music: "Song",
      credit: "Artist",
      music_reference_url: "https://example.com/music",
      intro_comment: "Intro",
      highlights: null,
      production_story: null,
      closing_comment: null,
      visibility_status: "public",
      scheduled_time: 1000,
      primary_event_id: "event1",
      collaboration_type: null,
      part: null,
    },
    eventIds: ["event1"],
    publicMembers: [
      {
        id: "vm1",
        display_name: "Member",
        x_user_id: "member",
        role_label: "担当",
        order_index: 0,
      },
    ],
    softwareLabels: ["After Effects"],
    appLikeCount: 5,
    publicChapters: [
      {
        id: "ch1",
        chapter_time: 10,
        chapter_label: "Start",
        note: null,
        author_name: "Creator",
        author_icon: null,
      },
    ],
    memberChapters: [
      {
        id: "vm1:member:0",
        video_member_id: "vm1",
        chapter_time: 20,
        chapter_label: "担当",
        note: null,
        order_index: 0,
      },
    ],
    publicEvents: [
      {
        id: "event1",
        title: "Event 1",
        icon_url: null,
        accent_color: "#ff0000",
        start_time: 100,
        end_time: 200,
        entry_start_time: null,
        entry_end_time: null,
        visibility_status: "public",
      },
    ],
    relatedVideos: [
      {
        id: "video2",
        title: "Related",
        youtube_video_id: "yt2",
        display_name: "Other",
        icon_url: null,
        creator_x_user_id: "other",
        primary_event_id: null,
        scheduled_time: 900,
      },
    ],
    relatedReserve: [],
    relatedRandomIds: [],
    relatedRandomReserve: [],
    relatedRandomSeed: "video1",
  };

  test("buildPublicVideoViewModelFromStatic maps extended static detail", () => {
    const vm =
      buildPublicVideoViewModelFromStatic(
        staticDetail,
        {
          iconMap: new Map([
            [
              "creator",
              {
                icon_url:
                  "https://example.com/creator.png",
                source: "registered",
              },
            ],
            [
              "other",
              {
                icon_url:
                  "https://example.com/other.png",
                source: "registered",
              },
            ],
          ]),
        },
      );
    assert.equal(vm.video.app_like_count, 5);
    assert.equal(vm.softwareLabel, "After Effects");
    assert.equal(vm.primaryEvent?.id, "event1");
    assert.equal(vm.publicChapters.length, 1);
    assert.equal(vm.memberChapters.length, 1);
    assert.equal(vm.relatedVideos[0].title, "Related");
    assert.equal(
      vm.video.creator_icon_url,
      "https://example.com/creator.png",
    );
    assert.equal(
      vm.relatedVideos[0].icon_url,
      "https://example.com/other.png",
    );
    assert.equal(
      vm.relatedVideos[0].creator_x_user_id,
      "other",
    );
  });

  test("buildPublicVideoViewModelFromDatabase maps D1 bundle shape", () => {
    const vm = buildPublicVideoViewModelFromDatabase({
      video: {
        id: "video1",
        title: "Video 1",
        youtube_video_id: "yt1",
        creator_display_name: "Creator",
        creator_icon_url: null,
        creator_x_user_id: "creator",
        music: "Song",
        credit: "Artist",
        music_reference_url: "https://example.com/music",
        intro_comment: "Intro",
        highlights: null,
        production_story: null,
        closing_comment: null,
        visibility_status: "public",
        scheduled_time: 1000,
        primary_event_id: "event1",
        collaboration_type: null,
        part: null,
        app_like_count: 7,
      },
      events: [
        {
          id: "event1",
          title: "Event 1",
          icon_url: null,
          accent_color: "#ff0000",
          start_time: 100,
          end_time: 200,
          entry_start_time: null,
          entry_end_time: null,
          visibility_status: "public",
        },
      ],
      members: [
        {
          id: "vm1",
          x_user_id: "member",
          name: "Member",
          role: "担当",
          comment: null,
          order_index: 0,
          x_name: null,
          icon_url: null,
        },
      ],
      chapters: [
        {
          id: "ch1",
          chapter_time: 10,
          chapter_label: "Start",
          note: null,
          author_name: "Creator",
          author_icon: null,
          visibility: "public",
        },
      ],
      memberChapters: [
        {
          id: "vm1:member:0",
          video_member_id: "vm1",
          chapter_time: 20,
          chapter_label: "担当",
          note: null,
          order_index: 0,
        },
      ],
      related: [
        {
          id: "video2",
          title: "Related",
          youtube_video_id: "yt2",
          display_name: "Other",
        },
      ],
      softwareLabel: "After Effects, Premiere Pro",
    });

    assert.equal(vm.appLikeCount, 7);
    assert.equal(vm.primaryEvent?.title, "Event 1");
    assert.equal(vm.publicMembers[0].display_name, "Member");
    assert.equal(vm.relatedVideos[0].display_name, "Other");
    assert.deepEqual(vm.softwareLabels, ["After Effects", "Premiere Pro"]);
  });
}
