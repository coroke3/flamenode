import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeStaticRecentVideoPage } from "../src/publicData/recentVideoCore.ts";
import { normalizeStaticPopularVideoPage } from "../src/publicData/popularVideoCore.ts";

// CURRENT has older R2 public list artifacts without status fields. Do not
// reject those legacy rows, but never publish a snapshot row explicitly marked
// private in either supported visibility field.
const rows = [
  { id: "legacy", title: "Legacy published without state", display_name: "A" },
  { id: "private-status", title: "Private by status", status: "private" },
  { id: "draft-visibility", title: "Draft by visibility", visibility_status: "draft" },
  { id: "revoked-even-if-status-public", title: "Revoked", status: "public", visibility_status: "private" },
  { id: "revoked-even-if-visibility-public", title: "Revoked", status: "private", visibility_status: "public" },
  { id: "public-both", title: "Public", status: "public", visibility_status: "public", display_name: "Creator" },
  { id: "public-visibility", title: "Public legacy alias", visibility_status: "public" },
  { id: "legacy-null", title: "Nullable old snapshot", status: null, visibility_status: null },
  { id: "scheduled-not-public", title: "Unpublished", status: "scheduled" },
];

for (const [name, normalize] of [
  ["recent", normalizeStaticRecentVideoPage],
  ["popular", normalizeStaticPopularVideoPage],
]) {
  test(`${name} list rejects every explicitly nonpublic snapshot row without breaking legacy rows`, () => {
    const result = normalize({ generated_at: 1234, total: 999, items: rows }, 1, 30);
    assert.ok(result);
    assert.deepEqual(result.videos.map((item) => item.id), [
      "legacy", "public-both", "public-visibility", "legacy-null",
    ]);
    assert.equal(result.total, 4, "private rows are excluded from visible totals");
    assert.equal(result.generatedAt, 1234);
    assert.ok(result.videos.every((item) => item.status === "public"));
    assert.equal(result.videos[0].title, "Legacy published without state");
    assert.equal(result.videos[1].display_name, "Creator");
  });

  test(`${name} list filters privacy before page selection`, () => {
    const first = normalize({ total: 9, items: rows }, 1, 2);
    const second = normalize({ total: 9, items: rows }, 2, 2);
    assert.ok(first);
    assert.ok(second);
    assert.deepEqual(first.videos.map((v) => v.id), ["legacy", "public-both"]);
    assert.deepEqual(second.videos.map((v) => v.id), ["public-visibility", "legacy-null"]);
    assert.equal(first.total, 4);
    assert.equal(second.total, 4);
  });
}
