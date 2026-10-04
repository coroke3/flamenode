import { cancelR2BodyBestEffort } from "../r2Body.ts";
import {
  emptyPublicVisibilityBlockedEntitiesManifest,
  normalizePublicVisibilityBlockedEntitiesManifest,
  PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
  PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES,
  type PublicVisibilityBlockedEntitiesManifest,
} from "./publicVisibilityManifestCore.ts";

/** Web と Worker が共有する blocked-entities manifest の R2 読み書き。 */

export const MANIFEST_PUT_MAX_RETRIES = 3;

export type VisibilityManifestBucket = {
  get(key: string): Promise<{
    text(): Promise<string>;
    etag?: string;
    size?: number;
    body?: unknown;
  } | null>;
  put(key: string, value: string, options?: R2PutOptions): Promise<unknown>;
};

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** 未作成なら空 manifest（etag null）を返す。壊れた・大きすぎる object は throw。 */
export async function readVisibilityManifestObject(
  bucket: Pick<VisibilityManifestBucket, "get">,
): Promise<{
  manifest: PublicVisibilityBlockedEntitiesManifest;
  etag: string | null;
}> {
  const object = await bucket.get(PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY);
  if (!object) {
    return {
      manifest: emptyPublicVisibilityBlockedEntitiesManifest(
        Math.floor(Date.now() / 1000),
      ),
      etag: null,
    };
  }
  // R2 exposes the exact object size before the body is read. Reject oversized
  // manifests before text() can allocate a large string in the Worker.
  const hasKnownSize = typeof object.size === "number";
  if (
    hasKnownSize &&
    (!Number.isFinite(object.size) ||
      object.size! < 0 ||
      object.size! > PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES)
  ) {
    await cancelR2BodyBestEffort(object);
    throw new Error("public_visibility_manifest_too_large");
  }
  const text = await object.text();
  // Real R2 reads already supplied an exact byte size above. Avoid a second
  // full TextEncoder pass on every public request; retain the body check for
  // tests/custom bucket doubles that omit size.
  if (!hasKnownSize && utf8ByteLength(text) > PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES) {
    throw new Error("public_visibility_manifest_too_large");
  }
  const parsed = normalizePublicVisibilityBlockedEntitiesManifest(
    JSON.parse(text),
  );
  if (!parsed) {
    throw new Error("public_visibility_manifest_malformed");
  }
  return { manifest: parsed, etag: object.etag ?? null };
}

function entityKey(
  entry: PublicVisibilityBlockedEntitiesManifest["entities"][number],
): string {
  return `${entry.entity_type}:${entry.entity_type === "x_user" ? entry.entity_id.toLowerCase() : entry.entity_id}`;
}

/** 競合相手が先に作った manifest へ、candidate にだけある entity を足す。 */
function mergeCandidateAdditions(
  latest: PublicVisibilityBlockedEntitiesManifest,
  candidate: PublicVisibilityBlockedEntitiesManifest,
): PublicVisibilityBlockedEntitiesManifest {
  const byEntity = new Map(
    latest.entities.map((entry) => [entityKey(entry), entry]),
  );
  for (const entry of candidate.entities) {
    const key = entityKey(entry);
    if (!byEntity.has(key)) byEntity.set(key, entry);
  }
  return {
    ...latest,
    revision: Math.max(latest.revision, candidate.revision) + 1,
    generated_at: Math.max(latest.generated_at, candidate.generated_at),
    entities: [...byEntity.values()],
  };
}

/**
 * manifest を CAS 付きで PUT する。
 * - `ifMatchEtag` が文字列: その ETag と一致するときだけ書く。
 * - `null`: 未作成のときだけ書く（If-None-Match: *）。競合相手が先に作っていたら
 *   再読込して candidate の追加分を merge し、その ETag で再試行する。
 * - `undefined`: 無条件に書く。
 * `mutateOnConflict` があれば、CAS 失敗時に最新 manifest へ変更を再適用して再試行する。
 */
export async function putVisibilityManifestWithCas(
  bucket: VisibilityManifestBucket,
  manifest: PublicVisibilityBlockedEntitiesManifest,
  ifMatchEtag: string | null | undefined,
  mutateOnConflict?: (
    latest: PublicVisibilityBlockedEntitiesManifest,
  ) => PublicVisibilityBlockedEntitiesManifest,
): Promise<void> {
  let candidate = manifest;
  let condition = ifMatchEtag;
  let lastError: unknown;
  for (let attempt = 0; attempt < MANIFEST_PUT_MAX_RETRIES; attempt += 1) {
    try {
      const body = JSON.stringify(candidate);
      if (utf8ByteLength(body) > PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES) {
        throw new Error("public_visibility_manifest_too_large");
      }
      const putOptions: R2PutOptions = {
        httpMetadata: { cacheControl: "no-store" },
      };
      if (condition) {
        putOptions.onlyIf = { etagMatches: condition };
      } else if (condition === null) {
        // HTTP If-None-Match: * is the R2 create-if-absent condition. A
        // missing manifest must not be written unconditionally, otherwise two
        // first producers can overwrite each other's blocked entity.
        putOptions.onlyIf = new Headers({ "If-None-Match": "*" });
      }
      const result = await bucket.put(
        PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
        body,
        putOptions,
      );
      if (result != null) return;
      // R2 resolves a failed onlyIf precondition with null instead of
      // throwing. Never report a lost CAS as a committed write.
      if (!mutateOnConflict && condition !== null) {
        throw new Error("public_visibility_manifest_precondition_failed");
      }
      const latest = await readVisibilityManifestObject(bucket);
      if (!latest.etag) {
        throw new Error("public_visibility_manifest_precondition_failed");
      }
      // The create-if-absent merge is what makes concurrent first upserts
      // lossless; a caller mutator re-applies its own change instead.
      candidate = mutateOnConflict
        ? mutateOnConflict(latest.manifest)
        : mergeCandidateAdditions(latest.manifest, candidate);
      condition = latest.etag;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("public_visibility_manifest_put_failed");
}
