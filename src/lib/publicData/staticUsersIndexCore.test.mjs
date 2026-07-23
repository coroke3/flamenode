import assert from "node:assert/strict";
import test from "node:test";
import {
  filterUsersIndexItems,
  normalizeStaticUsersIndex,
  paginateUsersIndexItems,
  sortUsersIndexItems,
} from "./staticUsersIndexCore.ts";

test("normalizeStaticUsersIndex は公開向け索引だけを返す", () => {
  const index = normalizeStaticUsersIndex({
    generated_at: 1_700_000_000,
    items: [
      {
        x_id: "creator_a",
        x_name: "Creator A",
        icon_url: "https://example.com/a.png",
        profile_text: "hello",
        personal_count: 2,
        collab_count: 1,
        total_works: 3,
        sort_score: 8,
        updated_at: 1_700_000_000,
      },
      {
        id: "bad",
      },
    ],
  });

  assert.ok(index);
  assert.equal(index.items.length, 1);
  assert.equal(index.items[0].x_id, "creator_a");
  assert.equal(index.items[0].total_works, 3);
});

test("users index の検索・並び替え・ページング", () => {
  const items = [
    {
      x_id: "alpha",
      x_name: "Alpha",
      icon_url: null,
      profile_text: null,
      youtube_channel_url: null,
      personal_count: 1,
      collab_count: 0,
      total_works: 1,
      sort_score: 2,
      updated_at: 1,
    },
    {
      x_id: "beta",
      x_name: "Beta",
      icon_url: null,
      profile_text: null,
      youtube_channel_url: null,
      personal_count: 3,
      collab_count: 0,
      total_works: 3,
      sort_score: 9,
      updated_at: 2,
    },
  ];

  assert.equal(filterUsersIndexItems(items, "alp").length, 1);
  assert.equal(sortUsersIndexItems(items, "works")[0].x_id, "beta");
  assert.equal(sortUsersIndexItems(items, "name")[0].x_name, "Alpha");
  const sorted = sortUsersIndexItems(items, "score");
  assert.deepEqual(paginateUsersIndexItems(sorted, 1, 1), {
    total: 2,
    totalPages: 2,
    safePage: 1,
    current: [sorted[0]],
  });
});
