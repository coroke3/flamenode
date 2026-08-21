import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUsersIndexV2Artifacts,
  filterUsersSearchLiteByQuery,
  normalizeUsersIndexV2Manifest,
  normalizeUsersIndexV2ScorePage,
  normalizeUsersSearchLiteV1,
  usersIndexV2ScorePageObjectKey,
  usersIndexV2SearchLiteObjectKey,
} from "./staticUsersIndexV2Core.ts";

function source(id, score) {
  return {
    x_id: id,
    x_name: id,
    icon_url: null,
    personal_count: 1,
    collab_count: 0,
    total_works: 1,
    sort_score: score,
  };
}

test("users index v2 は生成済みscore順を48件単位で分割する", () => {
  const items = Array.from({ length: 49 }, (_, index) =>
    source(`creator-${index + 1}`, 100 - index),
  );
  const artifacts = buildUsersIndexV2Artifacts({
    items,
    generatedAt: 1_700_000_000,
    generation: "generation-a",
  });

  assert.equal(artifacts.manifest.total, 49);
  assert.equal(artifacts.manifest.page_size, 48);
  assert.equal(artifacts.manifest.total_pages, 2);
  assert.equal(artifacts.scorePages[0].items.length, 48);
  assert.equal(artifacts.scorePages[1].items.length, 1);
  assert.equal(artifacts.scorePages[0].items[0].x_id, "creator-1");
  assert.equal(artifacts.scorePages[1].items[0].x_id, "creator-49");
  assert.equal(
    usersIndexV2ScorePageObjectKey("generation-a", 2),
    "users/index.v2/g/generation-a/score/2.json",
  );
  assert.equal(
    usersIndexV2SearchLiteObjectKey("generation-a"),
    "users/index.v2/g/generation-a/search-lite.v1.json",
  );
});

test("search-lite はscore順を維持したまま検索する", () => {
  const artifacts = buildUsersIndexV2Artifacts({
    items: [source("creator-a", 30), source("other", 20), source("creator-b", 10)],
    generatedAt: 1_700_000_000,
    generation: "generation-a",
  });

  assert.deepEqual(
    filterUsersSearchLiteByQuery(artifacts.searchLite.items, "creator").map(
      (item) => item.x_id,
    ),
    ["creator-a", "creator-b"],
  );
});

test("空のusers indexも1ページの有効世代として生成できる", () => {
  const artifacts = buildUsersIndexV2Artifacts({
    items: [],
    generatedAt: 1_700_000_000,
    generation: "generation-empty",
  });

  assert.equal(artifacts.manifest.total, 0);
  assert.equal(artifacts.manifest.total_pages, 1);
  assert.equal(artifacts.scorePages.length, 1);
  assert.deepEqual(artifacts.scorePages[0].items, []);
  assert.deepEqual(artifacts.searchLite.items, []);
});

test("manifest/page/search は世代情報を厳密に正規化する", () => {
  const artifacts = buildUsersIndexV2Artifacts({
    items: [source("creator-a", 10)],
    generatedAt: 1_700_000_000,
    generation: "generation-a",
  });

  assert.deepEqual(
    normalizeUsersIndexV2Manifest(artifacts.manifest),
    artifacts.manifest,
  );
  assert.deepEqual(
    normalizeUsersIndexV2ScorePage(artifacts.scorePages[0]),
    artifacts.scorePages[0],
  );
  assert.deepEqual(
    normalizeUsersSearchLiteV1(artifacts.searchLite),
    artifacts.searchLite,
  );

  assert.equal(
    normalizeUsersIndexV2Manifest({
      ...artifacts.manifest,
      total_pages: 2,
    }),
    null,
  );
  assert.equal(
    normalizeUsersIndexV2ScorePage({
      ...artifacts.scorePages[0],
      items: [{ broken: true }],
    }),
    null,
  );
  assert.throws(
    () => usersIndexV2ScorePageObjectKey("../unsafe", 1),
    /invalid users index v2 generation/,
  );
});
