import "server-only";

import type { VisibilityManifestHost } from "@flamenode/server-core/visibility/manifestHost";
import {
  readPublicVisibilityBlockedEntitiesManifest,
  writePublicVisibilityBlockedEntitiesManifest,
} from "./publicVisibilityManifest";

/**
 * The blocked-entities manifest as Next resolves it (getEnv bucket, missing-bucket policy and guard
 * mode stay in publicVisibilityManifest.ts). Handed to the visibility transition planners that
 * moved to packages/server-core in MIG-0615.
 */
export const nextVisibilityManifestHost: VisibilityManifestHost = {
  read: () => readPublicVisibilityBlockedEntitiesManifest(),
  write: (manifest, options) => writePublicVisibilityBlockedEntitiesManifest(manifest, options),
};
