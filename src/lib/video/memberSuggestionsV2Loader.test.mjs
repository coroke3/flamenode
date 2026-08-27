import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildMemberSuggestionArtifacts,
  MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY,
} from "./memberSuggestionsCore.ts";
import {
  buildMemberSuggestionsV2Artifacts,
  memberSuggestionsV2DirectoryObjectKey,
  memberSuggestionsV2PageObjectKey,
  MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY,
} from "./memberSuggestionsPostingsV2.ts";
import {
  loadMemberSuggestionsCandidatesV2FromBucket,
  resetMemberSuggestionsV2CacheForTest,
} from "./memberSuggestionsV2Loader.ts";

function jsonObject(value) {
  const serialized = JSON.stringify(value);
  return {
    size: new TextEncoder().encode(serialized).byteLength,
    async json() {
      return JSON.parse(serialized);
    },
  };
}

function fixture() {
  const items = [
    {
      x_user_id: "alice_mv",
      name: "Alice Movie",
      xAliases: ["alice_old"],
      nameAliases: ["ありす"],
      occurrenceCount: 4,
      lastSeenAt: 1_700_000_000,
      approvalStatus: "approved",
    },
    {
      x_user_id: "bob_motion",
      name: "Bob Motion",
      xAliases: [],
      nameAliases: ["ボブ"],
      occurrenceCount: 2,
      lastSeenAt: 1_700_000_100,
      approvalStatus: "approved",
    },
    {
      x_user_id: "charlie",
      name: "Charlie",
      xAliases: [],
      nameAliases: [],
      occurrenceCount: 1,
      lastSeenAt: null,
      approvalStatus: "pending",
    },
  ];
  const generation = "fixture-generation";
  const generatedAt = 1_800_000_000;
  const v1 = buildMemberSuggestionArtifacts({ items, generation, generatedAt });
  const v2 = buildMemberSuggestionsV2Artifacts({ items, generation, generatedAt });
  const objects = new Map([
    [MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY, v1.manifest],
    [MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY, v2.manifest],
  ]);
  for (const { bucket, directory } of v2.directories) {
    objects.set(memberSuggestionsV2DirectoryObjectKey(generation, bucket), directory);
  }
  for (const { bucket, page } of v2.pages) {
    objects.set(memberSuggestionsV2PageObjectKey(generation, bucket, page.page), page);
  }
  return { objects, generation };
}

test("V2 loaderはqueryに必要なpostingだけで候補を返しV1 indexを読まない", async () => {
  resetMemberSuggestionsV2CacheForTest();
  const { objects, generation } = fixture();
  const gets = [];
  const bucket = {
    async get(key) {
      gets.push(key);
      const value = objects.get(key);
      return value === undefined ? null : jsonObject(value);
    },
  };

  const result = await loadMemberSuggestionsCandidatesV2FromBucket(bucket, "alice");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.generation, generation);
  assert.equal(result.truncated, false);
  assert.ok(result.items.some((item) => item.x_user_id === "alice_mv"));
  assert.ok(!gets.some((key) => key.endsWith("/index.json")));
  assert.ok(gets.length < 10, `unexpected R2 GET fan-out: ${gets.length}`);
});

test("V1とV2のgenerationが不一致ならstale V2を使用しない", async () => {
  resetMemberSuggestionsV2CacheForTest();
  const { objects } = fixture();
  const stale = objects.get(MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY);
  objects.set(MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY, {
    ...stale,
    generation: "stale-generation",
  });
  const bucket = {
    async get(key) {
      const value = objects.get(key);
      return value === undefined ? null : jsonObject(value);
    },
  };

  const result = await loadMemberSuggestionsCandidatesV2FromBucket(bucket, "alice");
  assert.deepEqual(result, { ok: false, reason: "generation_mismatch" });
});
