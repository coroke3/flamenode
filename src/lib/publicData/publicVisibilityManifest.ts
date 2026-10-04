import "server-only";

import { cache } from "react";
import { getEnv } from "@/lib/cloudflare";
import {
  isEntityBlockedInManifest,
  emptyPublicVisibilityBlockedEntitiesManifest,
  resolvePublicVisibilityGuardMode,
  type PublicVisibilityBlockedEntitiesManifest,
  type PublicVisibilityFenceEntityType,
  type PublicVisibilityGuardMode,
} from "./publicVisibilityManifestCore";
import {
  putVisibilityManifestWithCas,
  readVisibilityManifestObject,
  type VisibilityManifestBucket,
} from "./publicVisibilityManifestR2";

type R2BucketLike = VisibilityManifestBucket;

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
      manifest: emptyPublicVisibilityBlockedEntitiesManifest(
        Math.floor(Date.now() / 1000),
      ),
      etag: null,
    };
  }
  return readVisibilityManifestObject(resolvedBucket);
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
  // ifMatchEtag を省略したときだけ無条件 PUT。明示した undefined は null
  // （create-if-absent）として扱う。
  const hasConditionalOption =
    options && Object.prototype.hasOwnProperty.call(options, "ifMatchEtag");
  await putVisibilityManifestWithCas(
    resolvedBucket,
    manifest,
    hasConditionalOption ? options?.ifMatchEtag ?? null : undefined,
    options?.mutateOnConflict,
  );
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
