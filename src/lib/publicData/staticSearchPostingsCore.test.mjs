import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStaticSearchPostingArtifacts,
  normalizeStaticSearchPostingDirectory,
  normalizeStaticSearchPostingManifest,
  normalizeStaticSearchPostingPage,
  staticSearchPostingBucket,
  staticSearchPostingDirectoryObjectKey,
  staticSearchPostingManifestObjectKey,
  staticSearchPostingPageObjectKey,
  staticSearchQueryGrams,
} from "./staticSearchPostingsCore.ts";

test("posting index は1/2/3文字queryを同じ生成規則でgram化する", () => {
  assert.deepEqual(staticSearchQueryGrams(""), []);
  assert.deepEqual(staticSearchQueryGrams("A"), ["a"]);
  assert.deepEqual(staticSearchQueryGrams("東京"), ["東京"]);
  assert.deepEqual(staticSearchQueryGrams("東京動画"), ["東京動", "京動画"]);
});

test("posting object keyはgeneration/bucket/pageの不正値を拒否する", () => {
  assert.equal(
    staticSearchPostingManifestObjectKey("gen-1"),
    "search-postings.v1/gen-1/manifest.json",
  );
  assert.equal(
    staticSearchPostingDirectoryObjectKey("gen-1", 0),
    "search-postings.v1/gen-1/directory/0.json",
  );
  assert.equal(
    staticSearchPostingPageObjectKey("gen-1", 0, 1),
    "search-postings.v1/gen-1/bucket/0/1.json",
  );
  assert.throws(() => staticSearchPostingManifestObjectKey("../evil"));
  assert.throws(() => staticSearchPostingDirectoryObjectKey("gen-1", Number.NaN));
  assert.throws(() => staticSearchPostingDirectoryObjectKey("gen-1", 1.5));
  assert.throws(() => staticSearchPostingPageObjectKey("gen-1", 0, 0));
  assert.throws(() =>
    staticSearchPostingPageObjectKey("gen-1", 0, Number.POSITIVE_INFINITY),
  );
});

test("posting builderは既存caller向けに1文字gramを既定維持する", () => {
  const artifacts = buildStaticSearchPostingArtifacts({
    items: [{ id: "one", text: "abc" }],
    generatedAt: 1,
    generation: "default-min-gram",
    keyOf: (item) => item.id,
    textOf: (item) => [item.text],
  });
  const grams = new Set(
    artifacts.pages.flatMap(({ page }) =>
      page.records.map((record) => record.gram),
    ),
  );
  assert.ok(grams.has("a"));
  assert.ok(grams.has("ab"));
  assert.ok(grams.has("abc"));
});

test("minGramLength=2は1文字gramを構築段階から省く", () => {
  const artifacts = buildStaticSearchPostingArtifacts({
    items: [{ id: "one", text: "abc" }],
    generatedAt: 1,
    generation: "min-gram-2",
    minGramLength: 2,
    keyOf: (item) => item.id,
    textOf: (item) => [item.text],
  });
  const grams = new Set(
    artifacts.pages.flatMap(({ page }) =>
      page.records.map((record) => record.gram),
    ),
  );
  assert.equal(grams.has("a"), false);
  assert.equal(grams.has("b"), false);
  assert.equal(grams.has("c"), false);
  assert.ok(grams.has("ab"));
  assert.ok(grams.has("bc"));
  assert.ok(grams.has("abc"));
});

test("不正なbuilder入力はsilentにartifact化せず失敗する", () => {
  assert.throws(() =>
    buildStaticSearchPostingArtifacts({
      items: [{ id: "one", text: "abc" }],
      generatedAt: 1,
      generation: "invalid-min-gram",
      minGramLength: Number.NaN,
      keyOf: (item) => item.id,
      textOf: (item) => [item.text],
    }),
  );
  assert.throws(() =>
    buildStaticSearchPostingArtifacts({
      items: [{ id: "one", text: "abc" }],
      generatedAt: 1.5,
      generation: "invalid-time",
      keyOf: (item) => item.id,
      textOf: (item) => [item.text],
    }),
  );
  assert.throws(() =>
    buildStaticSearchPostingArtifacts({
      items: [{ id: "one", text: "abc" }],
      generatedAt: 1,
      generation: "../invalid-generation",
      keyOf: (item) => item.id,
      textOf: (item) => [item.text],
    }),
  );
});

test("壊れたposting directory/pageはfail-closedで拒否する", () => {
  const tooManyPages = normalizeStaticSearchPostingDirectory({
    schema_version: 1,
    generation: "g1",
    bucket: 0,
    grams: {
      a: { total: 1, pages: Array.from({ length: 513 }, (_, index) => index + 1) },
    },
  });
  assert.equal(tooManyPages, null);

  assert.equal(
    normalizeStaticSearchPostingDirectory({
      schema_version: 1,
      generation: "g1",
      bucket: 0,
      grams: { a: { total: 2, pages: [1, 1] } },
    }),
    null,
  );
  assert.equal(
    normalizeStaticSearchPostingDirectory({
      schema_version: 1,
      generation: "g1",
      bucket: "0",
      grams: { a: { total: 1, pages: [1] } },
    }),
    null,
  );
  assert.equal(
    normalizeStaticSearchPostingDirectory({
      schema_version: 1,
      generation: "g1",
      bucket: 0,
      grams: { ABCD: { total: 1, pages: [1] } },
    }),
    null,
  );

  const tooManyItems = normalizeStaticSearchPostingPage(
    {
      schema_version: 1,
      generation: "g1",
      bucket: 0,
      page: 1,
      records: [
        {
          gram: "a",
          part: 0,
          total: 257,
          items: Array.from({ length: 257 }, () => ({ id: "x" })),
        },
      ],
    },
    (value) => value,
  );
  assert.equal(tooManyItems, null);

  assert.equal(
    normalizeStaticSearchPostingPage(
      {
        schema_version: 1,
        generation: "g1",
        bucket: 0,
        page: "1",
        records: [],
      },
      (value) => value,
    ),
    null,
  );
});

test("manifestの数値文字列や重複bucketはcorruptとして拒否する", () => {
  const valid = {
    schema_version: 1,
    generation: "g1",
    generated_at: 1,
    total: 1,
    bucket_count: 16,
    backend: "postings-v1",
    buckets: [0],
  };
  assert.ok(normalizeStaticSearchPostingManifest(valid));
  assert.equal(
    normalizeStaticSearchPostingManifest({ ...valid, generated_at: "1" }),
    null,
  );
  assert.equal(
    normalizeStaticSearchPostingManifest({ ...valid, buckets: [0, 0] }),
    null,
  );
});

test("posting index はdirectoryの対象ページだけを指し、ページをboundedに分割する", () => {
  const items = Array.from({ length: 300 }, (_, index) => ({
    id: `x-${index}`,
    name: `東京 Creator ${index}`,
  }));
  const artifacts = buildStaticSearchPostingArtifacts({
    items,
    generatedAt: 100,
    generation: "g1",
    keyOf: (item) => item.id,
    textOf: (item) => [item.id, item.name],
  });
  const bucket = staticSearchPostingBucket("東京");
  const directory = artifacts.directories.find((entry) => entry.bucket === bucket);
  assert.ok(directory);
  const gram = directory.directory.grams["東京"];
  assert.equal(gram.total, 300);
  assert.ok(gram.pages.length >= 2);
  for (const pageNumber of gram.pages) {
    const page = artifacts.pages.find(
      (entry) => entry.bucket === bucket && entry.page.page === pageNumber,
    );
    assert.ok(page);
    assert.ok(page.page.records.some((record) => record.gram === "東京"));
    assert.ok(
      page.page.records.reduce((sum, record) => sum + record.items.length, 0) <= 256,
    );
  }
  assert.deepEqual(
    normalizeStaticSearchPostingManifest(artifacts.manifest),
    artifacts.manifest,
  );
  assert.deepEqual(
    normalizeStaticSearchPostingDirectory(directory.directory),
    directory.directory,
  );
  const firstPage = artifacts.pages.find(
    (entry) => entry.bucket === bucket && entry.page.page === gram.pages[0],
  );
  assert.ok(firstPage);
  assert.deepEqual(
    normalizeStaticSearchPostingPage(firstPage.page, (value) =>
      value && typeof value === "object" ? value : null,
    ),
    firstPage.page,
  );
});
