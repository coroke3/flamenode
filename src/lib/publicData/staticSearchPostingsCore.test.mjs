import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStaticSearchPostingArtifacts,
  normalizeStaticSearchPostingDirectory,
  normalizeStaticSearchPostingManifest,
  normalizeStaticSearchPostingPage,
  staticSearchPostingBucket,
  staticSearchQueryGrams,
} from "./staticSearchPostingsCore.ts";

test("posting index は1/2/3文字queryを同じ生成規則でgram化する", () => {
  assert.deepEqual(staticSearchQueryGrams(""), []);
  assert.deepEqual(staticSearchQueryGrams("A"), ["a"]);
  assert.deepEqual(staticSearchQueryGrams("東京"), ["東京"]);
  assert.deepEqual(staticSearchQueryGrams("東京動画"), ["東京動", "京動画"]);
});

test("壊れたpostingのページ数・page item数はfail-closedで上限を超えない", () => {
  const tooManyPages = normalizeStaticSearchPostingDirectory({
    schema_version: 1,
    generation: "g1",
    bucket: 0,
    grams: {
      a: { total: 1, pages: Array.from({ length: 513 }, (_, index) => index + 1) },
    },
  });
  assert.equal(tooManyPages, null);

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
