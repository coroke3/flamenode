import "server-only";

import { cache } from "react";
import { getEnv } from "@/lib/cloudflare";
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
  } | null>;
  put: R2Bucket["put"];
};

export async function readPublicVisibilityBlockedEntitiesManifest(
  bucket?: R2BucketLike | null,
): Promise<{
  manifest: PublicVisibilityBlockedEntitiesManifest;
  etag: string | null;
}> {
  const resolvedBucket = bucket ?? getEnv().BUCKET ?? null;
  const now = Math.floor(Date.now() / 1000);
  if (!resolvedBucket) {
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
  const text = await object.text();
  if (utf8ByteLength(text) > PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES) {
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
    const { manifest } = await readPublicVisibilityBlockedEntitiesManifest();
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
