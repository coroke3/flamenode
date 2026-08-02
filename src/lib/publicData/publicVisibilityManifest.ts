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

type R2BucketLike = {
  get(key: string): Promise<{
    text(): Promise<string>;
    etag?: string;
    size?: number;
  } | null>;
  put(
    key: string,
    value: string | ArrayBuffer,
    options?: { httpMetadata?: { cacheControl?: string }; onlyIf?: unknown },
  ): Promise<unknown>;
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

export async function writePublicVisibilityBlockedEntitiesManifest(
  manifest: PublicVisibilityBlockedEntitiesManifest,
  options?: {
    bucket?: R2BucketLike | null;
    ifMatchEtag?: string | null;
  },
): Promise<void> {
  const resolvedBucket = options?.bucket ?? getEnv().BUCKET ?? null;
  if (!resolvedBucket) {
    throw new Error("public_visibility_manifest_bucket_missing");
  }
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
        httpMetadata: {
          cacheControl: "no-store",
        },
      };
      if (options?.ifMatchEtag) {
        putOptions.onlyIf = { etagMatches: options.ifMatchEtag };
      }
      await resolvedBucket.put(
        PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
        body,
        putOptions,
      );
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
