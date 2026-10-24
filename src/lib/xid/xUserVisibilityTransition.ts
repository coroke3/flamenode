// Compatibility bridge (MIG-0615, D-10): implementation lives in packages/server-core; remove when callers import it directly.
import "server-only";

import type { DB } from "@/lib/db/client";
import { nextVisibilityManifestHost } from "@/lib/publicData/visibilityManifestHost";
import { PUBLIC_LISTABLE_X_APPROVAL_STATUSES } from "@/lib/utils/publicXUser";
import {
  compensateXUserVisibilityOnD1Failure as compensateXUserVisibilityOnD1FailureCore,
  planXUserVisibilityFenceTransition as planXUserVisibilityFenceTransitionCore,
  preCommitXUserVisibilityTransition as preCommitXUserVisibilityTransitionCore,
} from "@flamenode/server-core/visibility/xUserTransition";

export type { XUserVisibilityFencePlan } from "@flamenode/server-core/visibility/xUserTransition";

export const xUserVisibilityHost = {
  manifest: nextVisibilityManifestHost,
  listableApprovalStatuses: PUBLIC_LISTABLE_X_APPROVAL_STATUSES,
};

export function planXUserVisibilityFenceTransition(
  input: Parameters<typeof planXUserVisibilityFenceTransitionCore>[0] & { db: DB },
) {
  return planXUserVisibilityFenceTransitionCore(input, xUserVisibilityHost);
}

export function preCommitXUserVisibilityTransition(
  input: Parameters<typeof preCommitXUserVisibilityTransitionCore>[0],
) {
  return preCommitXUserVisibilityTransitionCore(input, xUserVisibilityHost);
}

export function compensateXUserVisibilityOnD1Failure(
  input: Parameters<typeof compensateXUserVisibilityOnD1FailureCore>[0] & { db: DB },
) {
  return compensateXUserVisibilityOnD1FailureCore(input, xUserVisibilityHost);
}
