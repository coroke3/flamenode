import {
  MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY,
  memberSuggestionsIndexObjectKey,
  parseMemberSuggestionsIndex,
  parseMemberSuggestionsManifest,
  type MemberSuggestionItem,
} from "./memberSuggestionsCore.ts";

export type MemberSuggestionsLoadResult =
  | { ok: true; items: MemberSuggestionItem[] }
  | { ok: false; reason: string };

export type MemberSuggestionsManifestLoadResult =
  | { ok: true; generation: string; total: number }
  | { ok: false; reason: string };

/**
 * index payloadの短命プロセス内キャッシュ。
 * autocompleteは短時間に多数発行されるため、同一世代のindex R2 GET/JSON parseを
 * 減らす。manifestだけはcommit pointとして毎回確認し、世代更新後に旧itemsを返さない。
 */
const CACHE_TTL_SEC = 30;
type SuggestionsBucket = Pick<R2Bucket, "get">;
let cache: {
  bucket: SuggestionsBucket;
  generation: string;
  items: MemberSuggestionItem[];
  fetchedAt: number;
} | null = null;
let inFlight: {
  bucket: SuggestionsBucket;
  promise: Promise<MemberSuggestionsLoadResult>;
} | null = null;

function readCache(
  bucket: SuggestionsBucket,
  generation: string,
  nowSec: number,
): MemberSuggestionItem[] | null {
  if (!cache) return null;
  if (cache.bucket !== bucket || cache.generation !== generation) return null;
  if (nowSec - cache.fetchedAt > CACHE_TTL_SEC) {
    cache = null;
    return null;
  }
  return cache.items;
}

/** 主にテスト用。プロセス内キャッシュを破棄する。 */
export function resetMemberSuggestionsCacheForTest(): void {
  cache = null;
  inFlight = null;
}

/**
 * V1 manifestはautocompleteのcanonical generation commit point。
 * V2が古い世代を参照していないかをrequestごとに照合できるよう、index本体を
 * 読まずmanifestだけを返す。ここはcross-request cacheしない。
 */
export async function loadMemberSuggestionsManifestFromBucket(
  bucket: SuggestionsBucket,
): Promise<MemberSuggestionsManifestLoadResult> {
  const manifestObject = await bucket.get(MEMBER_SUGGESTIONS_MANIFEST_OBJECT_KEY);
  if (!manifestObject) return { ok: false, reason: "manifest_missing" };
  let manifestPayload: unknown;
  try {
    manifestPayload = await manifestObject.json();
  } catch {
    return { ok: false, reason: "manifest_invalid_json" };
  }
  const manifest = parseMemberSuggestionsManifest(manifestPayload);
  if (!manifest) return { ok: false, reason: "manifest_invalid" };
  return {
    ok: true,
    generation: manifest.generation,
    total: manifest.total,
  };
}

/**
 * R2からmember suggestions indexを読む。manifest → generation-specific indexの
 * 順に検証する。D1へのfallbackは意図的に存在しない（autocompleteのD1直読み禁止）。
 * bucketは呼び出し側（route）がbindingから渡す。テストではfake bucketを注入できる。
 */
export async function loadMemberSuggestionsIndexFromBucket(
  bucket: SuggestionsBucket,
): Promise<MemberSuggestionsLoadResult> {
  if (inFlight?.bucket === bucket) return inFlight.promise;

  const promise = (async (): Promise<MemberSuggestionsLoadResult> => {
    const manifestResult = await loadMemberSuggestionsManifestFromBucket(bucket);
    if (!manifestResult.ok) return manifestResult;

    const nowSec = Math.floor(Date.now() / 1000);
    const cachedItems = readCache(bucket, manifestResult.generation, nowSec);
    if (cachedItems) {
      return { ok: true, items: cachedItems };
    }

    const indexObject = await bucket.get(
      memberSuggestionsIndexObjectKey(manifestResult.generation),
    );
    if (!indexObject) return { ok: false, reason: "index_missing" };
    let indexPayload: unknown;
    try {
      indexPayload = await indexObject.json();
    } catch {
      return { ok: false, reason: "index_invalid_json" };
    }
    // schema/generation一致を確認してから候補として使う。
    const items = parseMemberSuggestionsIndex(
      indexPayload,
      manifestResult.generation,
    );
    if (!items) return { ok: false, reason: "index_invalid" };
    if (items.length !== manifestResult.total) {
      return { ok: false, reason: "index_total_mismatch" };
    }

    cache = {
      bucket,
      generation: manifestResult.generation,
      items,
      fetchedAt: nowSec,
    };
    return { ok: true, items };
  })();

  inFlight = { bucket, promise };
  try {
    return await promise;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
}
