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
 * R2からmember suggestions indexを読む。manifest → generation-specific indexの
 * 順に検証する。D1へのfallbackは意図的に存在しない（autocompleteのD1直読み禁止）。
 * bucketは呼び出し側（route）がbindingから渡す。テストではfake bucketを注入できる。
 */
export async function loadMemberSuggestionsIndexFromBucket(
  bucket: Pick<R2Bucket, "get">,
): Promise<MemberSuggestionsLoadResult> {
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
  return { ok: true, items };
}
