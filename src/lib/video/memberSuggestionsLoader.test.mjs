import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import {
  buildMemberSuggestionArtifacts,
  buildMemberSuggestionItems,
  MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY,
  MEMBER_SUGGESTIONS_MAX_INDEX_BYTES,
  MEMBER_SUGGESTIONS_MAX_MANIFEST_BYTES,
  memberSuggestionsIndexObjectKey,
} from "./memberSuggestionsCore.ts";
import {
  loadMemberSuggestionsIndexFromBucket,
  resetMemberSuggestionsCacheForTest,
} from "./memberSuggestionsLoader.ts";

beforeEach(() => {
  resetMemberSuggestionsCacheForTest();
});

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

test("manifest total and index item count must agree", async () => {
  const objects = new Map();
  publishValidIndex(objects);
  const manifest = JSON.parse(objects.get(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY));
  manifest.total += 1;
  objects.set(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY, JSON.stringify(manifest));
  const result = await loadMemberSuggestionsIndexFromBucket(createBucket(objects));
  assert.deepEqual(result, { ok: false, reason: "index_total_mismatch" });
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

test("同じR2 bucketへの同時ロードは読み込みを共有する", async () => {
  const objects = new Map();
  publishValidIndex(objects);
  const base = createBucket(objects);
  let getCount = 0;
  const bucket = {
    async get(key) {
      getCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 0));
      return base.get(key);
    },
  };

  const [first, second] = await Promise.all([
    loadMemberSuggestionsIndexFromBucket(bucket),
    loadMemberSuggestionsIndexFromBucket(bucket),
  ]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(getCount, 2);
});

test("3秒を超えて未解決のin-flightは共有せず新しいR2 readへ切り替える", async () => {
  const objects = new Map();
  publishValidIndex(objects);
  const base = createBucket(objects);
  let getCount = 0;
  let releaseFirst;
  const firstPending = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const bucket = {
    async get(key) {
      getCount += 1;
      if (getCount === 1) return firstPending;
      return base.get(key);
    },
  };

  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  let first;
  try {
    first = loadMemberSuggestionsIndexFromBucket(bucket);
    await Promise.resolve();
    assert.equal(getCount, 1);

    now += 3_001;
    const second = await loadMemberSuggestionsIndexFromBucket(bucket);
    assert.equal(second.ok, true);
    assert.equal(getCount, 3);
  } finally {
    Date.now = originalNow;
    releaseFirst?.(null);
    if (first) await first;
  }
});

test("manifest/indexは上限超過objectをJSON parse前に拒否する", async () => {
  let manifestParsed = false;
  const oversizedManifestBucket = {
    async get() {
      return {
        size: MEMBER_SUGGESTIONS_MAX_MANIFEST_BYTES + 1,
        async json() {
          manifestParsed = true;
          return {};
        },
      };
    },
  };
  const manifestResult = await loadMemberSuggestionsIndexFromBucket(
    oversizedManifestBucket,
  );
  assert.deepEqual(manifestResult, { ok: false, reason: "manifest_too_large" });
  assert.equal(manifestParsed, false);

  resetMemberSuggestionsCacheForTest();
  const objects = new Map();
  publishValidIndex(objects);
  const manifestBody = objects.get(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY);
  let indexParsed = false;
  const oversizedIndexBucket = {
    async get(key) {
      if (key === MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY) {
        return { size: manifestBody.length, async json() { return JSON.parse(manifestBody); } };
      }
      return {
        size: MEMBER_SUGGESTIONS_MAX_INDEX_BYTES + 1,
        async json() {
          indexParsed = true;
          return {};
        },
      };
    },
  };
  const indexResult = await loadMemberSuggestionsIndexFromBucket(oversizedIndexBucket);
  assert.deepEqual(indexResult, { ok: false, reason: "index_too_large" });
  assert.equal(indexParsed, false);
});

test("30秒cache中でもcanonical manifest generation更新後は旧候補を返さない", async () => {
  const objects = new Map();
  publishValidIndex(objects, "gen1");
  const bucket = createBucket(objects);

  const first = await loadMemberSuggestionsIndexFromBucket(bucket);
  assert.equal(first.ok, true);
  assert.ok(first.ok && first.items.some((item) => item.x_user_id === "mochi"));

  const nextItems = buildMemberSuggestionItems([
    {
      x_user_id: "new_creator",
      name: "New Creator",
      isProfileName: true,
      approvalStatus: "approved",
    },
  ]);
  const { manifest, index } = buildMemberSuggestionArtifacts({
    items: nextItems,
    generatedAt: 1001,
    generation: "gen2",
  });
  objects.set(memberSuggestionsIndexObjectKey("gen2"), JSON.stringify(index));
  objects.set(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY, JSON.stringify(manifest));

  const second = await loadMemberSuggestionsIndexFromBucket(bucket);
  assert.equal(second.ok, true);
  assert.deepEqual(
    second.ok ? second.items.map((item) => item.x_user_id) : [],
    ["new_creator"],
  );
});
