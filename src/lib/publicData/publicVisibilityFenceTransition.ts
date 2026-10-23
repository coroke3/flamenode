// Compatibility bridge (MIG-0615, D-10): implementation lives in packages/server-core; remove when callers import it directly.
import "server-only";

import { nextVisibilityManifestHost } from "./visibilityManifestHost";
import {
  compensatePublicVisibilityFenceOnD1Failure as compensatePublicVisibilityFenceOnD1FailureCore,
  preCommitPublicVisibilityFence as preCommitPublicVisibilityFenceCore,
} from "@flamenode/server-core/visibility/fenceTransition";

export {
  buildPublicVisibilityFenceUpsertStatement,
  planPublicVisibilityFenceTransition,
  type PublicVisibilityFencePlan,
} from "@flamenode/server-core/visibility/fenceTransition";

/** The manifest bucket lookup stays in publicVisibilityManifest.ts; Next hands it to the core here. */
const fenceHost = { manifest: nextVisibilityManifestHost };

export function preCommitPublicVisibilityFence(
  input: Parameters<typeof preCommitPublicVisibilityFenceCore>[0],
) {
  return preCommitPublicVisibilityFenceCore(input, fenceHost);
}

export function compensatePublicVisibilityFenceOnD1Failure(
  input: Parameters<typeof compensatePublicVisibilityFenceOnD1FailureCore>[0],
) {
  return compensatePublicVisibilityFenceOnD1FailureCore(input, fenceHost);
}
