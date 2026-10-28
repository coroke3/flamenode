import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildMemberSuggestionArtifacts,
  memberSuggestionsIndexObjectKey,
  MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY,
  MEMBER_SUGGESTIONS_MAX_MANIFEST_BYTES,
} from "../../../src/lib/video/memberSuggestionsCore.ts";
import {
  buildMemberSuggestionsV2Artifacts,
  memberSuggestionsV2DirectoryObjectKey,
  memberSuggestionsV2PageObjectKey,
  MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY,
} from "../../../src/lib/video/memberSuggestionsPostingsV2.ts";
import {
  loadMemberSuggestionsIndexFromBucket as currentV1,
  resetMemberSuggestionsCacheForTest as resetCurrentV1,
} from "../../../src/lib/video/memberSuggestionsLoader.ts";
import {
  loadMemberSuggestionsCandidatesV2FromBucket as currentV2,
  resetMemberSuggestionsV2CacheForTest as resetCurrentV2,
} from "../../../src/lib/video/memberSuggestionsV2Loader.ts";
import {
  loadMemberSuggestionsIndexFromBucket as coreV1,
  resetMemberSuggestionsCacheForTest as resetCoreV1,
} from "../src/memberSuggestion/loader.ts";
import {
  loadMemberSuggestionsCandidatesV2FromBucket as coreV2,
  resetMemberSuggestionsV2CacheForTest as resetCoreV2,
} from "../src/memberSuggestion/v2Loader.ts";
import {
  memberSuggestionQueryGrams as coreQueryGrams,
  memberSuggestionsV2PageObjectKey as corePageKey,
  normalizeMemberSuggestionPostingItem as coreParseItem,
} from "../src/memberSuggestion/postingsV2.ts";
import {
  memberSuggestionQueryGrams as currentQueryGrams,
  normalizeMemberSuggestionPostingItem as currentParseItem,
} from "../../../src/lib/video/memberSuggestionsPostingsV2.ts";

const members = [
  { x_user_id: "alice_mv", name: "Alice Movie", xAliases: ["alice_old"], nameAliases: ["ありす"], occurrenceCount: 4, lastSeenAt: 1700000000, approvalStatus: "approved" },
  { x_user_id: "bob_motion", name: "Bob Motion", xAliases: [], nameAliases: ["ボブ"], occurrenceCount: 2, lastSeenAt: 1700000100, approvalStatus: "approved" },
  { x_user_id: "charlie", name: "Charlie", xAliases: [], nameAliases: [], occurrenceCount: 1, lastSeenAt: null, approvalStatus: "pending" },
];
const generation = "migration-golden-01";
const bytes = (json) => new TextEncoder().encode(JSON.stringify(json)).length;

function fixture() {
  const generatedAt = 1800000000;
  const v1 = buildMemberSuggestionArtifacts({ items: members, generatedAt, generation });
  const v2 = buildMemberSuggestionsV2Artifacts({ items: members, generatedAt, generation });
  const objects = new Map([
    [MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY, v1.manifest],
    [memberSuggestionsIndexObjectKey(generation), v1.index],
    [MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY, v2.manifest],
  ]);
  for (const { bucket, directory } of v2.directories) {
    objects.set(memberSuggestionsV2DirectoryObjectKey(generation, bucket), directory);
  }
  for (const { bucket, page } of v2.pages) {
    objects.set(memberSuggestionsV2PageObjectKey(generation, bucket, page.page), page);
  }
  return objects;
}

function bucket(objects, gets) {
  return {
    async get(key) {
      gets.push(key);
      const value = objects.get(key);
      if (value === undefined) return null;
      if (value === "__bad_json__") {
        return { size: 1, async json() { throw new SyntaxError("invalid JSON"); } };
      }
      const serialized = JSON.stringify(value);
      return {
        size: new TextEncoder().encode(serialized).byteLength,
        async json() { return JSON.parse(serialized); },
      };
    },
  };
}

async function equalV1(objects) {
  resetCurrentV1();
  resetCoreV1();
  const before = [];
  const after = [];
  const a = await currentV1(bucket(objects, before));
  const b = await coreV1(bucket(objects, after));
  assert.deepEqual(b, a, "V1 result/status must be identical to CURRENT");
  assert.deepEqual(after, before, "V1 must perform the same bounded R2 reads");
  return a;
}

async function equalV2(objects, query) {
  resetCurrentV1();
  resetCoreV1();
  resetCurrentV2();
  resetCoreV2();
  const before = [];
  const after = [];
  const a = await currentV2(bucket(objects, before), query);
  const b = await coreV2(bucket(objects, after), query);
  assert.deepEqual(b, a, `V2 query=${query} result/status differs from CURRENT`);
  assert.deepEqual(after, before, `V2 query=${query} R2 keys differ from CURRENT`);
  return a;
}

test("MIG-0648 U01b: V1 generation and complete index match CURRENT", async () => {
  const result = await equalV1(fixture());
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.items.map((v) => v.x_user_id), members.map((v) => v.x_user_id));
});

test("MIG-0648 U01b: V1 missing/corrupt/oversized manifest fail closed as CURRENT", async () => {
  const missing = fixture();
  missing.delete(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY);
  assert.deepEqual(await equalV1(missing), { ok: false, reason: "manifest_missing" });

  const invalid = fixture();
  invalid.set(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY, "__bad_json__");
  assert.deepEqual(await equalV1(invalid), { ok: false, reason: "manifest_invalid_json" });

  const large = fixture();
  large.set(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY, { schema_version: 1, generation, total: 3, padding: "x".repeat(MEMBER_SUGGESTIONS_MAX_MANIFEST_BYTES) });
  assert.deepEqual(await equalV1(large), { ok: false, reason: "manifest_too_large" });
});

test("MIG-0648 U01b: V1 missing/mismatched generation index fails closed", async () => {
  const missing = fixture();
  missing.delete(memberSuggestionsIndexObjectKey(generation));
  assert.deepEqual(await equalV1(missing), { ok: false, reason: "index_missing" });

  const mismatch = fixture();
  const index = mismatch.get(memberSuggestionsIndexObjectKey(generation));
  mismatch.set(memberSuggestionsIndexObjectKey(generation), { ...index, generation: "stale" });
  assert.deepEqual(await equalV1(mismatch), { ok: false, reason: "index_invalid" });
});

test("MIG-0648 U01b: V2 posting reader agrees for exact, fuzzy and Unicode grams", async () => {
  for (const q of ["alice", "bob", "ボブ", "ありす", "charlie", "zzzz", "aa"]) {
    assert.deepEqual(coreQueryGrams(q), currentQueryGrams(q));
    const result = await equalV2(fixture(), q);
    assert.equal(result.ok, true);
  }
  assert.deepEqual(coreParseItem(members[0]), currentParseItem(members[0]));
  assert.equal(corePageKey(generation, 0, 1), memberSuggestionsV2PageObjectKey(generation, 0, 1));
});

test("MIG-0648 U01b: V2 manifest absence and generation mismatch preserve fallback signals", async () => {
  const missing = fixture();
  missing.delete(MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY);
  assert.deepEqual(await equalV2(missing, "alice"), { ok: false, reason: "manifest_missing" });

  const mismatch = fixture();
  const v2 = mismatch.get(MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY);
  mismatch.set(MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY, { ...v2, generation: "stale" });
  assert.deepEqual(await equalV2(mismatch, "alice"), { ok: false, reason: "generation_mismatch" });
});

test("MIG-0648 U01b: V2 truncated/corrupt directory and page are never accepted as complete", async () => {
  const invalidDir = fixture();
  const [directoryKey, directory] = [...invalidDir].find(([key]) => key.includes("/directory/"));
  invalidDir.set(directoryKey, { ...directory, generation: "stale" });
  assert.deepEqual(await equalV2(invalidDir, "alice"), await currentV2(bucket(invalidDir, []), "alice"));

  const brokenPage = fixture();
  const [pageKey, page] = [...brokenPage].find(([key]) => key.includes("/bucket/") && key.endsWith("/1.json"));
  brokenPage.set(pageKey, { ...page, page: 999 });
  for (const query of ["alice", "bob"]) {
    await equalV2(brokenPage, query);
  }
});

test("MIG-0648 U01b: cached V2 manifest is never reused after writer removes commit point", async () => {
  const objects = fixture();
  resetCurrentV1(); resetCoreV1(); resetCurrentV2(); resetCoreV2();
  const currentGets = [], coreGets = [];
  const a = bucket(objects, currentGets), b = bucket(objects, coreGets);
  assert.deepEqual(await coreV2(b, "alice"), await currentV2(a, "alice"));
  objects.delete(MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY);
  assert.deepEqual(await coreV2(b, "alice"), await currentV2(a, "alice"));
  assert.deepEqual(coreGets, currentGets);
});
