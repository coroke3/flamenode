import assert from "node:assert/strict";
import test from "node:test";
import {
  filterUsersIndexItems,
  normalizeStaticUsersIndex,
  paginateUsersIndexItems,
  prepareUsersIndexItems,
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

function entry({ id, name, score, works = 1 }) {
  return {
    x_id: id,
    x_name: name,
    icon_url: null,
    profile_text: null,
    youtube_channel_url: null,
    personal_count: works,
    collab_count: 0,
    total_works: works,
    sort_score: score,
    updated_at: 1,
  };
}

test("users index の検索・並び替え・ページング", () => {
  const items = [
    entry({ id: "alpha", name: "Alpha", score: 2, works: 1 }),
    entry({ id: "beta", name: "Beta", score: 9, works: 3 }),
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

test("score 表示は生成済み順序を保ち request-time sort を行わない", () => {
  const generatedScoreOrder = [
    entry({ id: "high-a", name: "あかり", score: 20 }),
    entry({ id: "high-b", name: "いおり", score: 20 }),
    entry({ id: "mid", name: "Mid Creator", score: 10 }),
    entry({ id: "low", name: "Low Creator", score: 1 }),
  ];

  assert.deepEqual(
    prepareUsersIndexItems(generatedScoreOrder, "", "score").map((row) => row.x_id),
    ["high-a", "high-b", "mid", "low"],
  );
});

test("score 検索は filter 後も score と同score日本語名順を維持する", () => {
  const generatedScoreOrder = [
    entry({ id: "creator-a", name: "あかり Creator", score: 20 }),
    entry({ id: "creator-b", name: "いおり Creator", score: 20 }),
    entry({ id: "other", name: "Other", score: 30 }),
    entry({ id: "creator-c", name: "Creator C", score: 10 }),
  ];

  assert.deepEqual(
    prepareUsersIndexItems(generatedScoreOrder, "creator", "score").map(
      (row) => row.x_id,
    ),
    ["creator-a", "creator-b", "creator-c"],
  );
});

test("score fast path 後も pagination の clamp と件数は従来通り", () => {
  const generatedScoreOrder = Array.from({ length: 5 }, (_, index) =>
    entry({
      id: `creator-${index + 1}`,
      name: `Creator ${index + 1}`,
      score: 100 - index,
    }),
  );
  const prepared = prepareUsersIndexItems(generatedScoreOrder, "", "score");

  assert.deepEqual(
    paginateUsersIndexItems(prepared, 9, 2).current.map((row) => row.x_id),
    ["creator-5"],
  );
  assert.equal(paginateUsersIndexItems(prepared, 9, 2).safePage, 3);
});

test("name / works は従来どおり明示的に並び替える", () => {
  const generatedScoreOrder = [
    entry({ id: "z", name: "Zed", score: 20, works: 1 }),
    entry({ id: "a", name: "Alpha", score: 10, works: 3 }),
  ];

  assert.deepEqual(
    prepareUsersIndexItems(generatedScoreOrder, "", "name").map((row) => row.x_id),
    ["a", "z"],
  );
  assert.deepEqual(
    prepareUsersIndexItems(generatedScoreOrder, "", "works").map((row) => row.x_id),
    ["a", "z"],
  );
});
