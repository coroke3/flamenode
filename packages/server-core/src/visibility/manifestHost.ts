import type { PublicVisibilityBlockedEntitiesManifest } from "./manifestCore.ts";

/**
 * Read/write of the blocked-entities manifest as the host resolves it. The host owns the bucket
 * lookup (getEnv), the missing-bucket policy and the guard mode, which the core must not read
 * from the ambient environment.
 */
export type VisibilityManifestHost = {
  read(): Promise<{
    manifest: PublicVisibilityBlockedEntitiesManifest;
    etag: string | null;
  }>;
  write(
    manifest: PublicVisibilityBlockedEntitiesManifest,
    options?: {
      ifMatchEtag?: string | null;
      mutateOnConflict?: (
        latest: PublicVisibilityBlockedEntitiesManifest,
      ) => PublicVisibilityBlockedEntitiesManifest;
    },
  ): Promise<void>;
};
