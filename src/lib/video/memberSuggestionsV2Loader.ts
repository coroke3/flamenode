import { cancelR2BodyBestEffort } from "../r2Body.ts";
import type { MemberSuggestionItem } from "./memberSuggestionsCore.ts";
import { loadMemberSuggestionsManifestFromBucket } from "./memberSuggestionsLoader.ts";
import {
  memberSuggestionPostingBucket,
  memberSuggestionQueryGrams,
  memberSuggestionsV2DirectoryObjectKey,
  memberSuggestionsV2PageObjectKey,
  normalizeMemberSuggestionsV2Directory,
  normalizeMemberSuggestionsV2Manifest,
  normalizeMemberSuggestionsV2Page,
  MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY,
  MEMBER_SUGGESTIONS_V2_MAX_ARTIFACT_BYTES,
  MEMBER_SUGGESTIONS_V2_MAX_CANDIDATES,
  MEMBER_SUGGESTIONS_V2_MAX_QUERY_PAGES,
} from "./memberSuggestionsPostingsV2.ts";

type SuggestionsBucket = Pick<R2Bucket, "get">;

type CachedJson = {
  value: unknown;
  fetchedAt: number;
};

type PageExpectation = {
  bucket: number;
  page: number;
  records: Map<string, { part: number; total: number }>;
};

type GramReadState = {
  total: number;
  itemCount: number;
  itemIds: Set<string>;
};

const JSON_CACHE_TTL_SEC = 30;
const JSON_CACHE_MAX_ENTRIES = 24;
// Isolate-global cache contains completed, parsed JSON only. Never store an R2
// binding or an I/O Promise here: Workers may reuse this isolate for unrelated
// HTTP requests and request-scoped I/O objects cannot safely cross contexts.
const jsonCache = new Map<string, CachedJson>();

export type MemberSuggestionsV2LoadResult =
  | {
      ok: true;
      items: MemberSuggestionItem[];
      truncated: boolean;
      generation: string;
    }
  | {
      ok: false;
      reason:
        | "v1_manifest_missing"
        | "v1_manifest_invalid"
        | "manifest_missing"
        | "manifest_invalid"
        | "generation_mismatch"
        | "directory_missing"
        | "directory_invalid"
        | "page_missing"
        | "page_invalid"
        | "query_budget_exceeded"
        | "artifact_too_large";
    };

function cacheKey(key: string): string {
  return `member-suggestions-v2:${key}`;
}

function rememberJson(
  key: string,
  value: unknown,
  nowSec: number,
): void {
  const keyValue = cacheKey(key);
  if (jsonCache.has(keyValue)) jsonCache.delete(keyValue);
  jsonCache.set(keyValue, { value, fetchedAt: nowSec });
  while (jsonCache.size > JSON_CACHE_MAX_ENTRIES) {
    const oldest = jsonCache.keys().next().value as string | undefined;
    if (!oldest) break;
    jsonCache.delete(oldest);
  }
}

async function readJson(
  bucket: SuggestionsBucket,
  key: string,
  options: { cache?: boolean } = {},
): Promise<
  | { ok: true; value: unknown }
  | { ok: false; reason: "missing" | "invalid" | "too_large" }
> {
  const useCache = options.cache !== false;
  const nowSec = Math.floor(Date.now() / 1000);
  const cached = useCache ? jsonCache.get(cacheKey(key)) : undefined;
  if (
    cached &&
    nowSec - cached.fetchedAt >= 0 &&
    nowSec - cached.fetchedAt <= JSON_CACHE_TTL_SEC
  ) {
    // LRU refresh without reparsing JSON. The key is generation-specific, so
    // completed JSON may be reused safely without retaining the current R2 binding.
    rememberJson(key, cached.value, nowSec);
    return { ok: true, value: cached.value };
  }

  const object = await bucket.get(key);
  if (!object) return { ok: false, reason: "missing" };
  if (
    typeof object.size === "number" &&
    object.size > MEMBER_SUGGESTIONS_V2_MAX_ARTIFACT_BYTES
  ) {
    await cancelR2BodyBestEffort(object);
    return { ok: false, reason: "too_large" };
  }
  try {
    const value = await object.json<unknown>();
    if (useCache) rememberJson(key, value, nowSec);
    return { ok: true, value };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

function selectLookupGrams(query: string): string[] {
  const grams = memberSuggestionQueryGrams(query);
  if (grams.length <= 1) return grams;
  const first = grams[0];
  const last = grams[grams.length - 1];
  return first === last ? [first] : [first, last];
}

/**
 * Queryに必要な2つ以下のgramだけを読む。V1 manifestとのgeneration一致を必須にし、
 * stale V2 manifestが残っていても古い候補を返さない。
 * V2 manifestはwriterの唯一のcommit pointなのでcross-request cacheを使わず、
 * 削除/fallback markerを次requestで必ず観測する。generation固有objectだけをcacheする。
 */
export async function loadMemberSuggestionsCandidatesV2FromBucket(
  bucket: SuggestionsBucket,
  query: string,
): Promise<MemberSuggestionsV2LoadResult> {
  const grams = selectLookupGrams(query);
  if (grams.length === 0) {
    return { ok: true, items: [], truncated: false, generation: "empty" };
  }

  // V1 manifestはcanonical commit point。V1 loaderと同じsize/schema guardを使い、
  // oversized/corrupt manifestをV2 pathだけ無制限parseする分岐を作らない。
  const v1Manifest = await loadMemberSuggestionsManifestFromBucket(bucket);
  if (!v1Manifest.ok) {
    return {
      ok: false,
      reason:
        v1Manifest.reason === "manifest_too_large"
          ? "artifact_too_large"
          : v1Manifest.reason === "manifest_missing"
            ? "v1_manifest_missing"
            : "v1_manifest_invalid",
    };
  }

  const manifestRead = await readJson(
    bucket,
    MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY,
    { cache: false },
  );
  if (!manifestRead.ok) {
    return {
      ok: false,
      reason:
        manifestRead.reason === "too_large"
          ? "artifact_too_large"
          : manifestRead.reason === "missing"
            ? "manifest_missing"
            : "manifest_invalid",
    };
  }
  const manifest = normalizeMemberSuggestionsV2Manifest(manifestRead.value);
  if (!manifest) return { ok: false, reason: "manifest_invalid" };
  if (
    manifest.generation !== v1Manifest.generation ||
    manifest.total !== v1Manifest.total
  ) {
    return { ok: false, reason: "generation_mismatch" };
  }

  const directories = new Map<
    number,
    ReturnType<typeof normalizeMemberSuggestionsV2Directory>
  >();
  const pageExpectations = new Map<string, PageExpectation>();
  const gramStates = new Map<string, GramReadState>();

  for (const gram of grams) {
    const bucketId = memberSuggestionPostingBucket(gram);
    let directory = directories.get(bucketId) ?? null;
    if (!directories.has(bucketId)) {
      const directoryRead = await readJson(
        bucket,
        memberSuggestionsV2DirectoryObjectKey(manifest.generation, bucketId),
      );
      if (!directoryRead.ok) {
        return {
          ok: false,
          reason:
            directoryRead.reason === "too_large"
              ? "artifact_too_large"
              : directoryRead.reason === "missing"
                ? "directory_missing"
                : "directory_invalid",
        };
      }
      directory = normalizeMemberSuggestionsV2Directory(directoryRead.value);
      if (
        !directory ||
        directory.generation !== manifest.generation ||
        directory.bucket !== bucketId
      ) {
        return { ok: false, reason: "directory_invalid" };
      }
      directories.set(bucketId, directory);
    }

    const entry = directory?.grams[gram];
    if (!entry) continue;
    if (
      entry.total <= 0 ||
      entry.pages.length === 0 ||
      new Set(entry.pages).size !== entry.pages.length
    ) {
      return { ok: false, reason: "directory_invalid" };
    }
    if (entry.pages.length > MEMBER_SUGGESTIONS_V2_MAX_QUERY_PAGES) {
      return { ok: false, reason: "query_budget_exceeded" };
    }

    gramStates.set(gram, {
      total: entry.total,
      itemCount: 0,
      itemIds: new Set<string>(),
    });
    for (let part = 0; part < entry.pages.length; part += 1) {
      const pageNumber = entry.pages[part]!;
      const key = memberSuggestionsV2PageObjectKey(
        manifest.generation,
        bucketId,
        pageNumber,
      );
      const existing = pageExpectations.get(key);
      if (
        existing &&
        (existing.bucket !== bucketId || existing.page !== pageNumber)
      ) {
        return { ok: false, reason: "directory_invalid" };
      }
      const expected = existing ?? {
        bucket: bucketId,
        page: pageNumber,
        records: new Map<string, { part: number; total: number }>(),
      };
      if (expected.records.has(gram)) {
        return { ok: false, reason: "directory_invalid" };
      }
      expected.records.set(gram, { part, total: entry.total });
      pageExpectations.set(key, expected);
    }
  }

  if (pageExpectations.size > MEMBER_SUGGESTIONS_V2_MAX_QUERY_PAGES) {
    return { ok: false, reason: "query_budget_exceeded" };
  }

  const candidates = new Map<string, MemberSuggestionItem>();
  let truncated = false;
  for (const [key, expectedPage] of pageExpectations) {
    const pageRead = await readJson(bucket, key);
    if (!pageRead.ok) {
      return {
        ok: false,
        reason:
          pageRead.reason === "too_large"
            ? "artifact_too_large"
            : pageRead.reason === "missing"
              ? "page_missing"
              : "page_invalid",
      };
    }
    const page = normalizeMemberSuggestionsV2Page(pageRead.value);
    if (
      !page ||
      page.generation !== manifest.generation ||
      page.bucket !== expectedPage.bucket ||
      page.page !== expectedPage.page
    ) {
      return { ok: false, reason: "page_invalid" };
    }

    const seenExpectedRecords = new Set<string>();
    for (const record of page.records) {
      const expectation = expectedPage.records.get(record.gram);
      if (!expectation) {
        // 選択したgramがdirectoryにないpageへ紛れ込んでいる場合もcorrupt。
        if (gramStates.has(record.gram)) {
          return { ok: false, reason: "page_invalid" };
        }
        continue;
      }
      if (
        seenExpectedRecords.has(record.gram) ||
        record.part !== expectation.part ||
        record.total !== expectation.total
      ) {
        return { ok: false, reason: "page_invalid" };
      }
      seenExpectedRecords.add(record.gram);

      const gramState = gramStates.get(record.gram);
      if (!gramState) return { ok: false, reason: "page_invalid" };
      for (const item of record.items) {
        if (gramState.itemIds.has(item.x_user_id)) {
          return { ok: false, reason: "page_invalid" };
        }
        gramState.itemIds.add(item.x_user_id);
        gramState.itemCount += 1;

        if (!candidates.has(item.x_user_id)) {
          // 1,536件までは完全な候補集合として許容し、1,537件目を検出した時だけ
          // partial rankingを避けるためtruncatedへ落とす。
          if (candidates.size >= MEMBER_SUGGESTIONS_V2_MAX_CANDIDATES) {
            truncated = true;
            break;
          }
          candidates.set(item.x_user_id, item);
        }
      }
      if (truncated) break;
    }
    if (truncated) break;
    if (seenExpectedRecords.size !== expectedPage.records.size) {
      return { ok: false, reason: "page_invalid" };
    }
  }

  if (!truncated) {
    for (const state of gramStates.values()) {
      if (state.itemCount !== state.total || state.itemIds.size !== state.total) {
        return { ok: false, reason: "page_invalid" };
      }
    }
  }

  return {
    ok: true,
    items: [...candidates.values()],
    truncated,
    generation: manifest.generation,
  };
}

export function resetMemberSuggestionsV2CacheForTest(): void {
  jsonCache.clear();
}
