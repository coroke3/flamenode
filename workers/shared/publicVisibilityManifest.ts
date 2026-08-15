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

type R2BucketLike = {
  get(key: string): Promise<{
    text(): Promise<string>;
    etag?: string;
  } | null>;
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { cacheControl?: string }; onlyIf?: unknown },
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
  const text = await object.text();
  if (text.length > PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES) {
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
  const body = JSON.stringify(manifest);
  if (body.length > PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES) {
    throw new Error("public_visibility_manifest_too_large");
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < MANIFEST_PUT_MAX_RETRIES; attempt += 1) {
    try {
      const putOptions: {
        httpMetadata: { cacheControl: string };
        onlyIf?: { etagMatches: string };
      } = {
        httpMetadata: { cacheControl: "no-store" },
      };
      if (ifMatchEtag) {
        putOptions.onlyIf = { etagMatches: ifMatchEtag };
      }
      const result = await bucket.put(
        PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
        body,
        putOptions,
      );
      // R2 resolves conditional PUT failures with null. Convert that into a
      // retryable error instead of reporting a lost CAS as a successful write.
      if (result == null) {
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
