import { cancelR2BodyBestEffort } from "../../src/lib/r2Body.ts";

export {
  PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
  PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES,
  emptyPublicVisibilityBlockedEntitiesManifest,
  isEntityBlockedInManifest,
  normalizePublicVisibilityBlockedEntitiesManifest,
  releaseBlockedEntityInManifest,
  resolvePublicVisibilityGuardMode,
  upsertBlockedEntityInManifest,
  type PublicVisibilityBlockedEntitiesManifest,
  type PublicVisibilityBlockedEntity,
  type PublicVisibilityFenceEntityType,
  type PublicVisibilityGuardMode,
} from "../../src/lib/publicData/publicVisibilityManifestCore.ts";

const MANIFEST_PUT_MAX_RETRIES = 3;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

type R2BucketLike = {
  get(key: string): Promise<{
    text(): Promise<string>;
    etag?: string;
    size?: number;
    body?: unknown;
  } | null>;
  put(
    key: string,
    value: string,
    options?: R2PutOptions,
  ): Promise<unknown>;
};

export async function readWorkerVisibilityBlockedEntitiesManifest(
  bucket: R2BucketLike,
): Promise<{
  manifest: import("../../src/lib/publicData/publicVisibilityManifestCore.ts").PublicVisibilityBlockedEntitiesManifest;
  etag: string | null;
}> {
  const {
    PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
    emptyPublicVisibilityBlockedEntitiesManifest,
    normalizePublicVisibilityBlockedEntitiesManifest,
    PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES,
  } = await import("../../src/lib/publicData/publicVisibilityManifestCore.ts");
  const now = Math.floor(Date.now() / 1000);
  const object = await bucket.get(PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY);
  if (!object) {
    return {
      manifest: emptyPublicVisibilityBlockedEntitiesManifest(now),
      etag: null,
    };
  }
  // Reject by metadata before buffering an oversized R2 body in memory.
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

export async function writeWorkerVisibilityBlockedEntitiesManifest(
  bucket: R2BucketLike,
  manifest: import("../../src/lib/publicData/publicVisibilityManifestCore.ts").PublicVisibilityBlockedEntitiesManifest,
  ifMatchEtag?: string | null,
): Promise<void> {
  const { PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY, PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES } =
    await import("../../src/lib/publicData/publicVisibilityManifestCore.ts");
  let candidate = manifest;
  let conditionalEtag = ifMatchEtag;
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
      if (conditionalEtag) {
        putOptions.onlyIf = { etagMatches: conditionalEtag };
      } else if (ifMatchEtag === null && conditionalEtag === null) {
        putOptions.onlyIf = new Headers({ "If-None-Match": "*" });
      }
      const result = await bucket.put(
        PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
        body,
        putOptions,
      );
      // R2 resolves conditional PUT failures with null. Convert that into a
      // retryable error instead of reporting a lost CAS as a successful write.
      if (result == null) {
        if (ifMatchEtag === null && conditionalEtag === null) {
          const latest = await readWorkerVisibilityBlockedEntitiesManifest(bucket);
          if (!latest.etag) {
            throw new Error("public_visibility_manifest_precondition_failed");
          }
          const entityKey = (entry) =>
            `${entry.entity_type}:${entry.entity_type === "x_user" ? entry.entity_id.toLowerCase() : entry.entity_id}`;
          const byEntity = new Map(
            latest.manifest.entities.map((entry) => [entityKey(entry), entry]),
          );
          for (const entry of candidate.entities) {
            const key = entityKey(entry);
            if (!byEntity.has(key)) byEntity.set(key, entry);
          }
          candidate = {
            ...latest.manifest,
            revision: Math.max(latest.manifest.revision, candidate.revision) + 1,
            generated_at: Math.max(
              latest.manifest.generated_at,
              candidate.generated_at,
            ),
            entities: [...byEntity.values()],
          };
          conditionalEtag = latest.etag;
          continue;
        }
        throw new Error("public_visibility_manifest_precondition_failed");
      }
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("public_visibility_manifest_put_failed");
}
