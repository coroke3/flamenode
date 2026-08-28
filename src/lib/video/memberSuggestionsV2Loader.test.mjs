import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildMemberSuggestionArtifacts,
  MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY,
  MEMBER_SUGGESTIONS_MAX_MANIFEST_BYTES,
  MEMBER_SUGGESTIONS_MAX_X_ALIASES,
} from "./memberSuggestionsCore.ts";
import {
  buildMemberSuggestionsV2Artifacts,
  memberSuggestionPostingBucket,
  memberSuggestionQueryGrams,
  memberSuggestionsV2DirectoryObjectKey,
  memberSuggestionsV2PageObjectKey,
  normalizeMemberSuggestionPostingItem,
  MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY,
  MEMBER_SUGGESTIONS_V2_MAX_CANDIDATES,
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

function bucketFromObjects(objects, gets = null) {
  return {
    async get(key) {
      gets?.push(key);
      const value = objects.get(key);
      return value === undefined ? null : jsonObject(value);
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
    objects.set(
      memberSuggestionsV2PageObjectKey(generation, bucket, page.page),
      page,
    );
  }
  return { objects, generation };
}

function boundaryFixture(count) {
  const generation = `boundary-${count}`;
  const gram = "aa";
  const bucketId = memberSuggestionPostingBucket(gram);
  const pages = Array.from({ length: Math.ceil(count / 256) }, (_, i) => i + 1);
  const objects = new Map([
    [
      MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY,
      {
        schema_version: 1,
        generation,
        generated_at: 1,
        total: count,
      },
    ],
    [
      MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY,
      {
        schema_version: 1,
        generation,
        generated_at: 1,
        total: count,
        bucket_count: 16,
        backend: "postings-v1",
        buckets: [bucketId],
      },
    ],
    [
      memberSuggestionsV2DirectoryObjectKey(generation, bucketId),
      {
        schema_version: 1,
        generation,
        bucket: bucketId,
        grams: { [gram]: { pages, total: count } },
      },
    ],
  ]);

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const start = pageIndex * 256;
    const end = Math.min(count, start + 256);
    const items = Array.from({ length: end - start }, (_, offset) => {
      const index = start + offset;
      return {
        x_user_id: `aa${index.toString(36).padStart(4, "0")}`,
        name: `Member ${index}`,
        xAliases: [],
        nameAliases: [],
        occurrenceCount: 1,
        lastSeenAt: null,
        approvalStatus: "approved",
      };
    });
    const pageNumber = pages[pageIndex];
    objects.set(memberSuggestionsV2PageObjectKey(generation, bucketId, pageNumber), {
      schema_version: 1,
      generation,
      bucket: bucketId,
      page: pageNumber,
      records: [{ gram, part: pageIndex, total: count, items }],
    });
  }
  return objects;
}

test("V2 object key helperはNaN/小数/無限値を受け付けない", () => {
  assert.throws(() => memberSuggestionsV2DirectoryObjectKey("gen", Number.NaN));
  assert.throws(() => memberSuggestionsV2DirectoryObjectKey("gen", 1.5));
  assert.throws(() =>
    memberSuggestionsV2PageObjectKey("gen", 0, Number.POSITIVE_INFINITY),
  );
  assert.throws(() => memberSuggestionsV2PageObjectKey("gen", 0, 1.25));
});

test("V2 posting itemもwriterのalias/整数境界を超える破損payloadを拒否する", () => {
  const base = {
    x_user_id: "alice_mv",
    name: "Alice",
    xAliases: [],
    nameAliases: [],
    occurrenceCount: 1,
    lastSeenAt: 1_700_000_000,
    approvalStatus: "approved",
  };
  assert.ok(normalizeMemberSuggestionPostingItem(base));
  assert.equal(
    normalizeMemberSuggestionPostingItem({
      ...base,
      xAliases: Array.from(
        { length: MEMBER_SUGGESTIONS_MAX_X_ALIASES + 1 },
        (_, i) => `alias${i}`,
      ),
    }),
    null,
  );
  assert.equal(
    normalizeMemberSuggestionPostingItem({ ...base, xAliases: ["BAD-ALIAS"] }),
    null,
  );
  assert.equal(
    normalizeMemberSuggestionPostingItem({ ...base, occurrenceCount: 1.5 }),
    null,
  );
  assert.equal(
    normalizeMemberSuggestionPostingItem({ ...base, lastSeenAt: 1.5 }),
    null,
  );
});

test("V2 loaderはqueryに必要なpostingだけで候補を返しV1 indexを読まない", async () => {
  resetMemberSuggestionsV2CacheForTest();
  const { objects, generation } = fixture();
  const gets = [];
  const result = await loadMemberSuggestionsCandidatesV2FromBucket(
    bucketFromObjects(objects, gets),
    "alice",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.generation, generation);
  assert.equal(result.truncated, false);
  assert.ok(result.items.some((item) => item.x_user_id === "alice_mv"));
  assert.ok(!gets.some((key) => key.endsWith("/index.json")));
  assert.ok(gets.length < 10, `unexpected R2 GET fan-out: ${gets.length}`);
});

test("V2 loaderはR2 keyとpage payloadのbucket/page不一致を拒否する", async () => {
  resetMemberSuggestionsV2CacheForTest();
  const { objects, generation } = fixture();
  const gram = memberSuggestionQueryGrams("alice")[0];
  const bucketId = memberSuggestionPostingBucket(gram);
  const directory = objects.get(
    memberSuggestionsV2DirectoryObjectKey(generation, bucketId),
  );
  const pageNumber = directory.grams[gram].pages[0];
  const pageKey = memberSuggestionsV2PageObjectKey(generation, bucketId, pageNumber);
  const page = objects.get(pageKey);
  objects.set(pageKey, { ...page, page: pageNumber + 100 });

  const result = await loadMemberSuggestionsCandidatesV2FromBucket(
    bucketFromObjects(objects),
    "alice",
  );
  assert.deepEqual(result, { ok: false, reason: "page_invalid" });
});

test("V2 loaderはdirectoryが要求したgram record欠落を完全結果として扱わない", async () => {
  resetMemberSuggestionsV2CacheForTest();
  const { objects, generation } = fixture();
  const gram = memberSuggestionQueryGrams("alice")[0];
  const bucketId = memberSuggestionPostingBucket(gram);
  const directory = objects.get(
    memberSuggestionsV2DirectoryObjectKey(generation, bucketId),
  );
  const pageNumber = directory.grams[gram].pages[0];
  const pageKey = memberSuggestionsV2PageObjectKey(generation, bucketId, pageNumber);
  const page = objects.get(pageKey);
  objects.set(pageKey, {
    ...page,
    records: page.records.filter((record) => record.gram !== gram),
  });

  const result = await loadMemberSuggestionsCandidatesV2FromBucket(
    bucketFromObjects(objects),
    "alice",
  );
  assert.deepEqual(result, { ok: false, reason: "page_invalid" });
});

test("候補上限ちょうどはcomplete、1件超過で初めてtruncatedになる", async () => {
  resetMemberSuggestionsV2CacheForTest();
  const exact = await loadMemberSuggestionsCandidatesV2FromBucket(
    bucketFromObjects(boundaryFixture(MEMBER_SUGGESTIONS_V2_MAX_CANDIDATES)),
    "aa",
  );
  assert.equal(exact.ok, true);
  if (exact.ok) {
    assert.equal(exact.items.length, MEMBER_SUGGESTIONS_V2_MAX_CANDIDATES);
    assert.equal(exact.truncated, false);
  }

  resetMemberSuggestionsV2CacheForTest();
  const overflow = await loadMemberSuggestionsCandidatesV2FromBucket(
    bucketFromObjects(boundaryFixture(MEMBER_SUGGESTIONS_V2_MAX_CANDIDATES + 1)),
    "aa",
  );
  assert.equal(overflow.ok, true);
  if (overflow.ok) {
    assert.equal(overflow.items.length, MEMBER_SUGGESTIONS_V2_MAX_CANDIDATES);
    assert.equal(overflow.truncated, true);
  }
});

test("V1とV2のgenerationが不一致ならstale V2を使用しない", async () => {
  resetMemberSuggestionsV2CacheForTest();
  const { objects } = fixture();
  const stale = objects.get(MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY);
  objects.set(MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY, {
    ...stale,
    generation: "stale-generation",
  });
  const result = await loadMemberSuggestionsCandidatesV2FromBucket(
    bucketFromObjects(objects),
    "alice",
  );
  assert.deepEqual(result, { ok: false, reason: "generation_mismatch" });
});

test("V2 manifest撤去後は同generationでもcached manifestを再利用しない", async () => {
  resetMemberSuggestionsV2CacheForTest();
  const { objects } = fixture();
  const gets = [];
  const bucket = bucketFromObjects(objects, gets);

  const first = await loadMemberSuggestionsCandidatesV2FromBucket(bucket, "alice");
  assert.equal(first.ok, true);

  // writerがV2 rebuild開始/失敗時にcommit pointを撤去した状態を再現する。
  // generation固有directory/pageがcacheに残っていてもmanifest不在ならV1へfallbackする。
  objects.delete(MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY);
  const beforeSecond = gets.filter(
    (key) => key === MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY,
  ).length;
  const second = await loadMemberSuggestionsCandidatesV2FromBucket(bucket, "alice");
  assert.deepEqual(second, { ok: false, reason: "manifest_missing" });
  const afterSecond = gets.filter(
    (key) => key === MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY,
  ).length;
  assert.equal(afterSecond, beforeSecond + 1, "manifest must be read from R2 again");
});

test("V2 pathもoversized V1 canonical manifestをparse前に拒否する", async () => {
  resetMemberSuggestionsV2CacheForTest();
  let parsed = false;
  const bucket = {
    async get(key) {
      if (key !== MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY) return null;
      return {
        size: MEMBER_SUGGESTIONS_MAX_MANIFEST_BYTES + 1,
        async json() {
          parsed = true;
          return {};
        },
      };
    },
  };

  const result = await loadMemberSuggestionsCandidatesV2FromBucket(bucket, "alice");
  assert.deepEqual(result, { ok: false, reason: "artifact_too_large" });
  assert.equal(parsed, false);
});
