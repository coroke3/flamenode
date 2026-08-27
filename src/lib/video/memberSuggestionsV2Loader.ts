import {
  MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY,
  parseMemberSuggestionsManifest,
  type MemberSuggestionItem,
} from "./memberSuggestionsCore.ts";
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
  bucket: SuggestionsBucket;
  value: unknown;
  fetchedAt: number;
};

const JSON_CACHE_TTL_SEC = 30;
const JSON_CACHE_MAX_ENTRIES = 24;
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
  bucket: SuggestionsBucket,
  key: string,
  value: unknown,
  nowSec: number,
): void {
  const keyValue = cacheKey(key);
  if (jsonCache.has(keyValue)) jsonCache.delete(keyValue);
  jsonCache.set(keyValue, { bucket, value, fetchedAt: nowSec });
  while (jsonCache.size > JSON_CACHE_MAX_ENTRIES) {
    const oldest = jsonCache.keys().next().value as string | undefined;
    if (!oldest) break;
    jsonCache.delete(oldest);
  }
}

async function readJson(
  bucket: SuggestionsBucket,
  key: string,
): Promise<{ ok: true; value: unknown } | { ok: false; reason: "missing" | "invalid" | "too_large" }> {
  const nowSec = Math.floor(Date.now() / 1000);
  const cached = jsonCache.get(cacheKey(key));
  if (
    cached &&
    cached.bucket === bucket &&
    nowSec - cached.fetchedAt >= 0 &&
    nowSec - cached.fetchedAt <= JSON_CACHE_TTL_SEC
  ) {
    // LRU refresh without reparsing JSON.
    rememberJson(bucket, key, cached.value, nowSec);
    return { ok: true, value: cached.value };
  }

  const object = await bucket.get(key);
  if (!object) return { ok: false, reason: "missing" };
  if (
    typeof object.size === "number" &&
    object.size > MEMBER_SUGGESTIONS_V2_MAX_ARTIFACT_BYTES
  ) {
    return { ok: false, reason: "too_large" };
  }
  try {
    const value = await object.json<unknown>();
    rememberJson(bucket, key, value, nowSec);
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
 */
export async function loadMemberSuggestionsCandidatesV2FromBucket(
  bucket: SuggestionsBucket,
  query: string,
): Promise<MemberSuggestionsV2LoadResult> {
  const grams = selectLookupGrams(query);
  if (grams.length === 0) {
    return { ok: true, items: [], truncated: false, generation: "empty" };
  }

  const v1ManifestObject = await bucket.get(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY);
  if (!v1ManifestObject) return { ok: false, reason: "v1_manifest_missing" };
  let v1Payload: unknown;
  try {
    v1Payload = await v1ManifestObject.json<unknown>();
  } catch {
    return { ok: false, reason: "v1_manifest_invalid" };
  }
  const v1Manifest = parseMemberSuggestionsManifest(v1Payload);
  if (!v1Manifest) return { ok: false, reason: "v1_manifest_invalid" };

  const manifestRead = await readJson(bucket, MEMBER_SUGGESTIONS_V2_MANIFEST_OBJECT_KEY);
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

  const directories = new Map<number, ReturnType<typeof normalizeMemberSuggestionsV2Directory>>();
  const pageKeys = new Set<string>();
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
      if (!directory || directory.generation !== manifest.generation) {
        return { ok: false, reason: "directory_invalid" };
      }
      directories.set(bucketId, directory);
    }

    const entry = directory?.grams[gram];
    if (!entry) continue;
    if (entry.pages.length > MEMBER_SUGGESTIONS_V2_MAX_QUERY_PAGES) {
      return { ok: false, reason: "query_budget_exceeded" };
    }
    for (const page of entry.pages) {
      pageKeys.add(
        memberSuggestionsV2PageObjectKey(manifest.generation, bucketId, page),
      );
    }
  }

  if (pageKeys.size > MEMBER_SUGGESTIONS_V2_MAX_QUERY_PAGES) {
    return { ok: false, reason: "query_budget_exceeded" };
  }

  const candidates = new Map<string, MemberSuggestionItem>();
  let truncated = false;
  for (const key of pageKeys) {
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
    if (!page || page.generation !== manifest.generation) {
      return { ok: false, reason: "page_invalid" };
    }
    for (const record of page.records) {
      if (!grams.includes(record.gram)) continue;
      for (const item of record.items) {
        if (!candidates.has(item.x_user_id)) {
          candidates.set(item.x_user_id, item);
          if (candidates.size >= MEMBER_SUGGESTIONS_V2_MAX_CANDIDATES) {
            truncated = true;
            break;
          }
        }
      }
      if (truncated) break;
    }
    if (truncated) break;
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
