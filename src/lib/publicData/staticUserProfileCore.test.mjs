import { test } from "node:test";
import assert from "node:assert/strict";
import { runTestWithTsx } from "../testing/runTestWithTsx.mjs";

if (runTestWithTsx(import.meta.url)) {
  const {
    normalizeStaticUserProfile,
    normalizeStaticUserVideoPage,
    STATIC_USER_COLLABS_PAGE_SIZE,
    STATIC_USER_WORKS_PAGE_SIZE,
  } = await import("./staticUserProfileCore.ts");

  test("normalizeStaticUserProfile: normalizes paginated user profile payload", () => {
    const profile = normalizeStaticUserProfile({
      generated_at: 100,
      page_size: 24,
      user: {
        id: "creator",
        x_name: "Creator",
        icon_url: "https://example.com/icon.png",
      },
      works: {
        total: 2,
        items: [
          {
            id: "video1",
            title: "Video 1",
            youtube_video_id: "abcdefghijk",
            display_name: "Creator",
            creator_x_user_id: "creator",
            status: "public",
          },
        ],
      },
      collabs: {
        total: 1,
        items: [
          {
            id: "video2",
            title: "Collab",
            display_name: "Other",
            status: "public",
          },
        ],
      },
    });

    assert.ok(profile);
    assert.equal(profile.generatedAt, 100);
    assert.equal(profile.user.id, "creator");
    assert.equal(profile.works.total, 2);
    assert.equal(profile.works.pageSize, STATIC_USER_WORKS_PAGE_SIZE);
    assert.equal(profile.works.items[0].display_name, "Creator");
    assert.equal(
      profile.works.items[0].creator_x_user_id,
      "creator",
    );
    assert.equal(profile.collabs.total, 1);
    assert.equal(profile.collabs.pageSize, STATIC_USER_COLLABS_PAGE_SIZE);
  });

  test("normalizeStaticUserProfile: legacy recent_videos maps to works", () => {
    const profile = normalizeStaticUserProfile({
      user: { id: "creator", x_name: "Creator" },
      total_works: 3,
      recent_videos: [
        { id: "public", title: "Public", status: "public" },
      ],
    });
    assert.ok(profile);
    assert.equal(profile.works.total, 3);
    assert.deepEqual(profile.works.items.map((video) => video.id), ["public"]);
    assert.equal(profile.collabs.total, 0);
  });

  test("normalizeStaticUserProfile: rejects payload without user id", () => {
    assert.equal(normalizeStaticUserProfile({ user: { x_name: "Creator" } }), null);
  });

  test("normalizeStaticUserProfile: excludes non-public cards", () => {
    const profile = normalizeStaticUserProfile({
      user: { id: "creator", x_name: "Creator" },
      works: {
        items: [
          { id: "public", title: "Public", status: "public" },
          { id: "private", title: "Private", status: "private" },
        ],
      },
    });
    assert.ok(profile);
    assert.deepEqual(profile.works.items.map((video) => video.id), ["public"]);
  });

  test("normalizeStaticUserVideoPage: normalizes paged works payload", () => {
    const page = normalizeStaticUserVideoPage(
      {
        generated_at: 50,
        page: 2,
        page_size: 24,
        total: 40,
        items: [{ id: "video2", title: "Page 2", status: "public" }],
      },
      2,
      STATIC_USER_WORKS_PAGE_SIZE,
    );
    assert.ok(page);
    assert.equal(page.page, 2);
    assert.equal(page.total, 40);
    assert.equal(page.items[0].id, "video2");
  });

  test("normalizeStaticUserProfile: collabの同一作品をIDで重複除去する", () => {
    const profile =
      normalizeStaticUserProfile({
        user: {
          id: "member",
          x_name: "Member",
        },
        collabs: {
          total: 1,
          items: [
            {
              id: "collab-1",
              title: "Collab",
              display_name: "Creator",
              creator_x_user_id:
                "creator",
              status: "public",
            },
            {
              id: "collab-1",
              title: "Collab",
              display_name: "Creator",
              creator_x_user_id:
                "creator",
              status: "public",
            },
          ],
        },
      });

    assert.ok(profile);
    assert.equal(
      profile.collabs.items.length,
      1,
    );
    assert.equal(
      profile.collabs.items[0]
        .creator_x_user_id,
      "creator",
    );
  });
}
