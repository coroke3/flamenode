import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUsersIndexV2Artifacts,
  normalizeUsersIndexV2Manifest,
  normalizeUsersIndexV2Page,
  normalizeUsersIndexV2ScorePage,
  normalizeUsersSearchLiteV1,
  prepareUsersSearchLiteItems,
  usersIndexV2PageObjectKey,
  usersIndexV2ScorePageObjectKey,
  usersIndexV2SearchLiteObjectKey,
} from "./staticUsersIndexV2Core.ts";

function source(id, score, works = 1, name = id) {
  return {
    x_id: id,
    x_name: name,
    icon_url: null,
    personal_count: works,
    collab_count: 0,
    total_works: works,
    sort_score: score,
  };
}

test("users index v2 はscore/works/nameを48件単位で事前分割する", () => {
  const items = Array.from({ length: 49 }, (_, index) =>
    source(`creator-${index + 1}`, 100 - index, index + 1),
  );
  const artifacts = buildUsersIndexV2Artifacts({
    items,
    generatedAt: 1_700_000_000,
    generation: "generation-a",
  });

  assert.equal(artifacts.manifest.total, 49);
  assert.equal(artifacts.manifest.page_size, 48);
  assert.equal(artifacts.manifest.total_pages, 2);
  assert.deepEqual(artifacts.manifest.sorts, ["score", "works", "name"]);
  assert.equal(artifacts.scorePages[0].items.length, 48);
  assert.equal(artifacts.scorePages[1].items.length, 1);
  assert.equal(artifacts.worksPages[0].items[0].x_id, "creator-49");
  assert.equal(artifacts.namePages[0].sort, "name");
  assert.equal(
    usersIndexV2ScorePageObjectKey("generation-a", 2),
    "users/index.v2/g/generation-a/score/2.json",
  );
  assert.equal(
    usersIndexV2PageObjectKey("generation-a", "works", 1),
    "users/index.v2/g/generation-a/works/1.json",
  );
  assert.equal(
    usersIndexV2SearchLiteObjectKey("generation-a"),
    "users/index.v2/g/generation-a/search-lite.v1.json",
  );
});

test("search-lite はfilter後に指定sortだけを候補集合へ適用する", () => {
  const artifacts = buildUsersIndexV2Artifacts({
    items: [
      source("creator-b", 30, 1, "Beta Creator"),
      source("other", 20, 9, "Other"),
      source("creator-a", 10, 3, "Alpha Creator"),
    ],
    generatedAt: 1_700_000_000,
    generation: "generation-a",
  });

  assert.deepEqual(
    prepareUsersSearchLiteItems(artifacts.searchLite.items, "creator", "score").map(
      (item) => item.x_id,
    ),
    ["creator-b", "creator-a"],
  );
  assert.deepEqual(
    prepareUsersSearchLiteItems(artifacts.searchLite.items, "creator", "works").map(
      (item) => item.x_id,
    ),
    ["creator-a", "creator-b"],
  );
  assert.deepEqual(
    prepareUsersSearchLiteItems(artifacts.searchLite.items, "creator", "name").map(
      (item) => item.x_id,
    ),
    ["creator-a", "creator-b"],
  );
});

test("空のusers indexも各sort 1ページの有効世代として生成できる", () => {
  const artifacts = buildUsersIndexV2Artifacts({
    items: [],
    generatedAt: 1_700_000_000,
    generation: "generation-empty",
  });

  assert.equal(artifacts.manifest.total, 0);
  assert.equal(artifacts.manifest.total_pages, 1);
  assert.equal(artifacts.scorePages.length, 1);
  assert.equal(artifacts.worksPages.length, 1);
  assert.equal(artifacts.namePages.length, 1);
  assert.deepEqual(artifacts.scorePages[0].items, []);
  assert.deepEqual(artifacts.searchLite.items, []);
});

test("manifest/page/search は世代とsort情報を厳密に正規化する", () => {
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
    normalizeUsersIndexV2Page(artifacts.worksPages[0]),
    artifacts.worksPages[0],
  );
  assert.deepEqual(
    normalizeUsersSearchLiteV1(artifacts.searchLite),
    artifacts.searchLite,
  );

  assert.equal(
    normalizeUsersIndexV2Manifest({
      ...artifacts.manifest,
      sorts: ["score"],
    }),
    null,
  );
  assert.equal(
    normalizeUsersIndexV2Page({
      ...artifacts.worksPages[0],
      sort: "broken",
    }),
    null,
  );
  assert.throws(
    () => usersIndexV2ScorePageObjectKey("../unsafe", 1),
    /invalid users index v2 generation/,
  );
  assert.equal(
    usersIndexV2PageObjectKey("generation-a", "score", Number.NaN),
    "users/index.v2/g/generation-a/score/1.json",
  );
});
