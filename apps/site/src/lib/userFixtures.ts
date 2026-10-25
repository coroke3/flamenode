/**
 * Fixture payloads for the user routes when no snapshot directory is configured (MIG-0504).
 * They have the shape of CURRENT `users/index.json`, `users/ID.json` and `users/ID/works/N.json`,
 * so the same CURRENT normalizers project them. Cases covered: a full profile, a profile without
 * optional fields, a profile with five display pages (artifact pages 1..2), a profile whose private /
 * unlisted videos must not render, and users that must not be emitted at all.
 */
type Payload = Record<string, unknown>;

function video(id: string, over: Payload = {}): Payload {
  return {
    id,
    title: `作品 ${id}`,
    youtube_video_id: `yt${id.replace(/[^a-z0-9]/gi, "").padEnd(9, "0").slice(0, 9)}`,
    display_name: "初音P",
    icon_url: "https://example.com/miku.png",
    creator_x_user_id: "miku_producer",
    primary_event_id: null,
    scheduled_time: 1760000000,
    status: "public",
    part: null,
    ...over,
  };
}

const manyWorks = Array.from({ length: 40 }, (_, i) => video(`w${String(i + 1).padStart(2, "0")}`, { creator_x_user_id: "long_list" }));

export const FIXTURE_USER_PROFILES: Readonly<Record<string, Payload>> = {
  "miku_producer": {
    generated_at: 1760000000,
    user: {
      id: "miku_producer",
      x_name: "初音P",
      icon_url: "https://example.com/miku.png",
      profile_text: "FlameNodeでボカロ楽曲・映像を制作しています。",
      portfolio_contact: "contact@example.com",
      youtube_channel_url: "https://www.youtube.com/@miku",
      other_social_links: JSON.stringify([
        { type: "Website", url: "https://miku.example.com/" },
        { type: "X", url: "https://x.com/miku_producer" },
        { type: "Email", url: "contact@example.com" },
      ]),
    },
    works: {
      total: 3,
      items: [
        video("a1", { part: "Aパート" }),
        video("a2"),
        video("a-private", { status: "private", title: "非公開の作品" }),
        video("a-voided", { status: "voided", title: "無効の作品" }),
      ],
    },
    collabs: { total: 1, items: [video("c1", { display_name: "合作チーム", creator_x_user_id: "team" })] },
  },
  minimal_user: {
    generated_at: 1760000000,
    user: { id: "minimal_user", x_name: "minimal_user", icon_url: null, profile_text: null, portfolio_contact: "portfolio_contact" },
    works: { total: 0, items: [] },
    collabs: { total: 0, items: [] },
  },
  long_list: {
    generated_at: 1760000000,
    user: { id: "long_list", x_name: "長い一覧", icon_url: null, profile_text: "作品が多いクリエイター", portfolio_contact: null },
    works: { total: 40, items: manyWorks.slice(0, 24) },
    collabs: { total: 0, items: [] },
  },
};

/** Paged siblings (n >= 2), keyed like the build snapshot keys: ID.works.N */
export const FIXTURE_USER_PAGES: Readonly<Record<string, Payload>> = {
  "long_list.works.2": { generated_at: 1760000000, page: 2, page_size: 24, total: 40, items: manyWorks.slice(24, 40) },
};

export const FIXTURE_USERS_INDEX: Payload = {
  generated_at: 1760000000,
  // Pre-sorted by score DESC like CURRENT users/index.json (the score view does not re-sort).
  items: [
    { x_id: "long_list", x_name: "長い一覧", icon_url: null, personal_count: 40, collab_count: 0, total_works: 40, sort_score: 120 },
    { x_id: "miku_producer", x_name: "初音P", icon_url: "https://example.com/miku.png", personal_count: 3, collab_count: 1, total_works: 4, sort_score: 11 },
    { x_id: "minimal_user", x_name: "minimal_user", icon_url: null, personal_count: 0, collab_count: 0, total_works: 0, sort_score: 0 },
    // Listed in the index but with no published profile object: banned, merged or unapproved. Not emitted.
    { x_id: "suspended_user", x_name: "停止ユーザー", icon_url: null, personal_count: 1, collab_count: 0, total_works: 1, sort_score: 3 },
  ],
};
