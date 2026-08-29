import "server-only";

import { cache } from "react";
import { getEnv } from "@/lib/cloudflare";
import { cancelR2BodyBestEffort } from "@/lib/r2Body";
import {
  emptyPublicVisibilityBlockedEntitiesManifest,
  isEntityBlockedInManifest,
  normalizePublicVisibilityBlockedEntitiesManifest,
  PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
  PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES,
  resolvePublicVisibilityGuardMode,
  type PublicVisibilityBlockedEntitiesManifest,
  type PublicVisibilityFenceEntityType,
  type PublicVisibilityGuardMode,
} from "./publicVisibilityManifestCore";

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
  put: R2Bucket["put"];
};

function resolveManifestBucket(
  bucket: R2BucketLike | null | undefined,
): R2BucketLike | null {
  if (bucket !== undefined) return bucket;
  try {
    return getEnv().BUCKET ?? null;
  } catch {
    return null;
  }
}

export async function readPublicVisibilityBlockedEntitiesManifest(
  bucket?: R2BucketLike | null,
): Promise<{
  manifest: PublicVisibilityBlockedEntitiesManifest;
  etag: string | null;
}> {
  const resolvedBucket = resolveManifestBucket(bucket);
  const now = Math.floor(Date.now() / 1000);
  if (!resolvedBucket) {
    const mode = resolvePublicVisibilityGuardModeFromEnv();
    if (mode === "enforce") {
      throw new Error("public_visibility_manifest_bucket_missing");
    }
    if (mode === "observe") {
      console.warn(
        JSON.stringify({
          service: "public-visibility-guard",
          mode,
          result: "manifest_bucket_missing",
        }),
      );
    }
    return {
      manifest: emptyPublicVisibilityBlockedEntitiesManifest(now),
      etag: null,
    };
  }
  const object = await resolvedBucket.get(
    PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
  );
  if (!object) {
    return {
      manifest: emptyPublicVisibilityBlockedEntitiesManifest(now),
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

export async function writePublicVisibilityBlockedEntitiesManifest(
  manifest: PublicVisibilityBlockedEntitiesManifest,
  options?: {
    bucket?: R2BucketLike | null;
    ifMatchEtag?: string | null;
    mutateOnConflict?: (
      latest: PublicVisibilityBlockedEntitiesManifest,
    ) => PublicVisibilityBlockedEntitiesManifest;
  },
): Promise<void> {
  const resolvedBucket = options?.bucket ?? getEnv().BUCKET ?? null;
  if (!resolvedBucket) {
    throw new Error("public_visibility_manifest_bucket_missing");
  }
  let candidate = manifest;
  let lastError: unknown;
  for (let attempt = 0; attempt < MANIFEST_PUT_MAX_RETRIES; attempt += 1) {
    try {
      const body = JSON.stringify(candidate);
      if (utf8ByteLength(body) > PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES) {
        throw new Error("public_visibility_manifest_too_large");
      }
      const hasConditionalOption =
        options && Object.prototype.hasOwnProperty.call(options, "ifMatchEtag");
      const ifMatchEtag = hasConditionalOption
        ? options?.ifMatchEtag ?? null
        : undefined;
      const putOptions: R2PutOptions = {
        httpMetadata: {
          cacheControl: "no-store",
        },
      };
      if (ifMatchEtag) {
        putOptions.onlyIf = { etagMatches: ifMatchEtag };
      } else if (hasConditionalOption && ifMatchEtag === null) {
        // HTTP If-None-Match: * is the R2 create-if-absent condition. A
        // missing manifest must not be written unconditionally, otherwise two
        // first producers can overwrite each other's blocked entity.
        putOptions.onlyIf = new Headers({ "If-None-Match": "*" });
      }
      const result = await resolvedBucket.put(
        PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
        body,
        putOptions,
      );
      // R2 returns null (rather than throwing) when an onlyIf precondition
      // fails. Treat that as a CAS failure so callers never assume that a
      // stale manifest write was committed.
      if (result == null) {
        if (options?.mutateOnConflict) {
          const latest = await readPublicVisibilityBlockedEntitiesManifest(
            resolvedBucket,
          );
          if (!latest.etag) {
            throw new Error("public_visibility_manifest_precondition_failed");
          }
          candidate = options.mutateOnConflict(latest.manifest);
          options = { ...options, ifMatchEtag: latest.etag };
          continue;
        }
        if (hasConditionalOption && ifMatchEtag === null) {
          // The object was created by a competing producer. Re-read it and
          // merge the candidate's additions before retrying against its ETag;
          // this is what makes concurrent first upserts lossless.
          const latest = await readPublicVisibilityBlockedEntitiesManifest(
            resolvedBucket,
          );
          if (!latest.etag) {
            throw new Error("public_visibility_manifest_precondition_failed");
          }
          const entityKey = (entry: PublicVisibilityBlockedEntitiesManifest["entities"][number]) =>
            `${entry.entity_type}:${entry.entity_type === "x_user" ? entry.entity_id.toLowerCase() : entry.entity_id}`;
          const byEntity = new Map(
            latest.manifest.entities.map((entry) => [
              entityKey(entry),
              entry,
            ]),
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
          options = { ...options, ifMatchEtag: latest.etag };
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

export const loadPublicVisibilityBlockedEntitiesManifest = cache(
  async (): Promise<PublicVisibilityBlockedEntitiesManifest> => {
    const { manifest, etag } =
      await readPublicVisibilityBlockedEntitiesManifest();
    // The low-level reader intentionally preserves the empty-manifest result
    // for first-producer CAS/bootstrap flows. Public reads in enforce mode
    // have a stricter contract: without a committed R2 object there is no
    // visibility snapshot to trust, so callers must fail closed instead of
    // serving stale R2/Cache or degraded D1 data against an empty snapshot.
    if (
      resolvePublicVisibilityGuardModeFromEnv() === "enforce" &&
      !etag?.trim()
    ) {
      throw new Error("public_visibility_manifest_missing");
    }
    return manifest;
  },
);

export function resolvePublicVisibilityGuardModeFromEnv(
  env?: Record<string, string | undefined> | null,
): PublicVisibilityGuardMode {
  return resolvePublicVisibilityGuardMode(
    env?.PUBLIC_VISIBILITY_GUARD_MODE ??
      process.env.PUBLIC_VISIBILITY_GUARD_MODE,
  );
}

export async function isPublicEntityVisibilityBlocked(args: {
  entityType: PublicVisibilityFenceEntityType;
  entityId: string;
  guardMode?: PublicVisibilityGuardMode;
  manifest?: PublicVisibilityBlockedEntitiesManifest;
}): Promise<boolean> {
  const guardMode =
    args.guardMode ?? resolvePublicVisibilityGuardModeFromEnv();
  if (guardMode === "off") return false;
  const manifest =
    args.manifest ?? (await loadPublicVisibilityBlockedEntitiesManifest());
  const blocked = isEntityBlockedInManifest(
    manifest,
    args.entityType,
    args.entityId,
  );
  if (guardMode === "observe" && blocked) {
    console.warn(
      JSON.stringify({
        service: "public-visibility-guard",
        mode: guardMode,
        entity_type: args.entityType,
        entity_id: args.entityId,
        result: "blocked_observe",
      }),
    );
  }
  return guardMode === "enforce" && blocked;
}
