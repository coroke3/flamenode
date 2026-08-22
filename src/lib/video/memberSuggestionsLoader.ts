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

/**
 * index payloadの短命プロセス内キャッシュ。
 * autocompleteは短時間に多数発行されるため、同一世代のR2 GET/JSON parseを
 * 減らす。TTLは静的rebuildの反映遅延より十分短く、失敗時は即破棄する。
 */
const CACHE_TTL_SEC = 30;
type SuggestionsBucket = Pick<R2Bucket, "get">;
let cache: {
  bucket: SuggestionsBucket;
  items: MemberSuggestionItem[];
  fetchedAt: number;
} | null = null;
let inFlight: {
  bucket: SuggestionsBucket;
  promise: Promise<MemberSuggestionsLoadResult>;
} | null = null;

function readCache(
  bucket: SuggestionsBucket,
  nowSec: number,
): MemberSuggestionItem[] | null {
  if (!cache) return null;
  if (cache.bucket !== bucket) return null;
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
 * R2からmember suggestions indexを読む。manifest → generation-specific indexの
 * 順に検証する。D1へのfallbackは意図的に存在しない（autocompleteのD1直読み禁止）。
 * bucketは呼び出し側（route）がbindingから渡す。テストではfake bucketを注入できる。
 */
export async function loadMemberSuggestionsIndexFromBucket(
  bucket: SuggestionsBucket,
): Promise<MemberSuggestionsLoadResult> {
  if (inFlight?.bucket === bucket) return inFlight.promise;

  const promise = (async (): Promise<MemberSuggestionsLoadResult> => {
  const nowSec = Math.floor(Date.now() / 1000);
  const cachedItems = readCache(bucket, nowSec);
  if (cachedItems) {
    return { ok: true, items: cachedItems };
  }

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

  const indexObject = await bucket.get(
    memberSuggestionsIndexObjectKey(manifest.generation),
  );
  if (!indexObject) return { ok: false, reason: "index_missing" };
  let indexPayload: unknown;
  try {
    indexPayload = await indexObject.json();
  } catch {
    return { ok: false, reason: "index_invalid_json" };
  }
  // schema/generation一致を確認してから候補として使う。
  const items = parseMemberSuggestionsIndex(indexPayload, manifest.generation);
  if (!items) return { ok: false, reason: "index_invalid" };
  if (items.length !== manifest.total) {
    return { ok: false, reason: "index_total_mismatch" };
  }

  cache = { bucket, items, fetchedAt: nowSec };
  return { ok: true, items };
  })();

  inFlight = { bucket, promise };
  try {
    return await promise;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
}
