// Compatibility bridge (MIG-0615, D-10): implementation lives in packages/server-core; remove when callers import it directly.
import "server-only";

import type { DB } from "@/lib/db/client";
import { nextVisibilityManifestHost } from "@/lib/publicData/visibilityManifestHost";
import {
  compensateEventVisibilityFenceOnD1Failure as compensateEventVisibilityFenceOnD1FailureCore,
  compensateEventVisibilityFenceRenameOnD1Failure as compensateEventVisibilityFenceRenameOnD1FailureCore,
  compensateEventVisibilityRenameTombstoneOnD1Failure as compensateEventVisibilityRenameTombstoneOnD1FailureCore,
  preCommitEventVisibilityFenceRename as preCommitEventVisibilityFenceRenameCore,
  preCommitEventVisibilityRenameTombstone as preCommitEventVisibilityRenameTombstoneCore,
  preCommitEventVisibilityTransition as preCommitEventVisibilityTransitionCore,
} from "@flamenode/server-core/visibility/eventTransition";

export {
  planEventVisibilityTransition,
  type EventVisibilityFenceRenamePrecommit,
  type EventVisibilityRenameTombstonePrecommit,
  type EventVisibilityTransitionPlan,
} from "@flamenode/server-core/visibility/eventTransition";

const fenceHost = { manifest: nextVisibilityManifestHost };

export function preCommitEventVisibilityTransition(
  input: Parameters<typeof preCommitEventVisibilityTransitionCore>[0],
) {
  return preCommitEventVisibilityTransitionCore(input, fenceHost);
}

export function preCommitEventVisibilityFenceRename(
  input: Parameters<typeof preCommitEventVisibilityFenceRenameCore>[0],
) {
  return preCommitEventVisibilityFenceRenameCore(input, fenceHost);
}

export function preCommitEventVisibilityRenameTombstone(
  input: Parameters<typeof preCommitEventVisibilityRenameTombstoneCore>[0],
) {
  return preCommitEventVisibilityRenameTombstoneCore(input, fenceHost);
}

export function compensateEventVisibilityFenceRenameOnD1Failure(
  input: Parameters<typeof compensateEventVisibilityFenceRenameOnD1FailureCore>[0],
) {
  return compensateEventVisibilityFenceRenameOnD1FailureCore(input, fenceHost);
}

export function compensateEventVisibilityRenameTombstoneOnD1Failure(
  input: Parameters<typeof compensateEventVisibilityRenameTombstoneOnD1FailureCore>[0],
) {
  return compensateEventVisibilityRenameTombstoneOnD1FailureCore(input, fenceHost);
}

export function compensateEventVisibilityFenceOnD1Failure(
  db: DB,
  input: Parameters<typeof compensateEventVisibilityFenceOnD1FailureCore>[1],
) {
  return compensateEventVisibilityFenceOnD1FailureCore(db, input, fenceHost);
}
