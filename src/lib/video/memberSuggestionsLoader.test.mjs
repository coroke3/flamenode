import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildMemberSuggestionArtifacts,
  buildMemberSuggestionItems,
  MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY,
  memberSuggestionsIndexObjectKey,
} from "./memberSuggestionsCore.ts";
import { loadMemberSuggestionsIndexFromBucket } from "./memberSuggestionsLoader.ts";

function createBucket(objects) {
  return {
    async get(key) {
      const value = objects.get(key);
      if (value === undefined) return null;
      if (value instanceof Error) throw value;
      if (typeof value === "string" && value === "__invalid_json__") {
        return {
          key,
          json: async () => {
            throw new SyntaxError("bad json");
          },
        };
      }
      return { key, json: async () => JSON.parse(value) };
    },
  };
}

function publishValidIndex(objects, generation = "gen1") {
  const items = buildMemberSuggestionItems([
    { x_user_id: "mochi", name: "Mochi", isProfileName: true, approvalStatus: "approved" },
    { x_user_id: "pending1", name: "Pending", isProfileName: true, approvalStatus: "pending" },
  ]);
  const { manifest, index } = buildMemberSuggestionArtifacts({
    items,
    generatedAt: 1000,
    generation,
  });
  objects.set(memberSuggestionsIndexObjectKey(generation), JSON.stringify(index));
  objects.set(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY, JSON.stringify(manifest));
}

test("正常なmanifest + indexから候補を読める", async () => {
  const objects = new Map();
  publishValidIndex(objects);
  const result = await loadMemberSuggestionsIndexFromBucket(createBucket(objects));
  assert.ok(result.ok);
  assert.equal(result.items?.length, 2);
});

test("manifest欠落時はmanifest_missingで503相当を返す（D1 fallbackなし）", async () => {
  const result = await loadMemberSuggestionsIndexFromBucket(createBucket(new Map()));
  assert.deepEqual(result, { ok: false, reason: "manifest_missing" });
});

test("壊れたmanifest JSONはmanifest_invalid_json", async () => {
  const objects = new Map();
  objects.set(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY, "__invalid_json__");
  const result = await loadMemberSuggestionsIndexFromBucket(createBucket(objects));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "manifest_invalid_json");
});

test("schema不一致のmanifestはmanifest_invalid", async () => {
  const objects = new Map();
  objects.set(
    MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY,
    JSON.stringify({ schema_version: 99, generation: "gen1", total: 0 }),
  );
  const result = await loadMemberSuggestionsIndexFromBucket(createBucket(objects));
  assert.equal(result.reason, "manifest_invalid");
});

test("generation-specific indexが無い場合はindex_missing", async () => {
  const objects = new Map();
  objects.set(
    MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY,
    JSON.stringify({ schema_version: 1, generation: "gone", generated_at: 1, total: 0 }),
  );
  const result = await loadMemberSuggestionsIndexFromBucket(createBucket(objects));
  assert.equal(result.reason, "index_missing");
});

test("indexのgenerationがmanifestと不一致ならindex_invalid", async () => {
  const objects = new Map();
  // 内部generationがgenAのindexを実物としてgenA/genB両keyに置き、
  // manifestだけgenBへ向ける。schema/generation一致確認で拒否される。
  const items = buildMemberSuggestionItems([
    { x_user_id: "mochi", name: "Mochi", isProfileName: true, approvalStatus: "approved" },
  ]);
  const { index } = buildMemberSuggestionArtifacts({
    items,
    generatedAt: 1,
    generation: "genA",
  });
  objects.set(memberSuggestionsIndexObjectKey("genA"), JSON.stringify(index));
  objects.set(memberSuggestionsIndexObjectKey("genB"), JSON.stringify(index));
  objects.set(
    MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY,
    JSON.stringify({
      schema_version: 1,
      generation: "genB",
      generated_at: 1,
      total: 1,
      object_key: memberSuggestionsIndexObjectKey("genB"),
    }),
  );
  const result = await loadMemberSuggestionsIndexFromBucket(createBucket(objects));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "index_invalid");
});
