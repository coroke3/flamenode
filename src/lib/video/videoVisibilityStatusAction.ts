import { unstable_rethrow } from "next/navigation";
import { eq } from "drizzle-orm";
import { AuditMutationError, mutateWithAudit } from "@/lib/audit/mutate";
import type { DB } from "@/lib/db/client";
import { videos } from "@/lib/db/schema";
import { createTraceId } from "@/lib/observability/flowTrace";
import { markPendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";
import type { PendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";
import {
  compensateDepublicizationFenceOnD1Failure,
  preCommitVideoVisibilityDepublicization,
  type VideoVisibilityTransitionPlan,
} from "@/lib/video/videoVisibilityTransition";
import {
  executeVideoVisibilityStatusMutation as executeVideoVisibilityStatusMutationCore,
  type ExecuteVideoVisibilityStatusMutationInput,
  type VideoVisibilityStatusMutationHost,
  type VideoStatusActionResult,
} from "@flamenode/server-core/video/visibilityStatusMutation";

const VISIBILITY_PRECOMMIT_ERROR_MARKERS = [
  "public_visibility_fence",
  "public_visibility_manifest",
] as const;

function isVisibilityPrecommitFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return VISIBILITY_PRECOMMIT_ERROR_MARKERS.some((marker) =>
    message.includes(marker),
  );
}

export type { VideoStatusActionResult };
export type ExecuteMutationInput = ExecuteVideoVisibilityStatusMutationInput<DB> & {
  transition: VideoVisibilityTransitionPlan;
};
export type { PendingPublicReflection };

export {
  SAME_VIDEO_STATUS_MESSAGE,
  loadVideoRebuildEventIds,
  mergeVideoRebuildEventIds,
  monotonicVideoUpdatedAt,
} from "@/lib/video/videoVisibilityStatusCore";

const mutationHost: VideoVisibilityStatusMutationHost<DB> = {
  createTraceId,
  preCommit: preCommitVideoVisibilityDepublicization,
  mutate: (db, mutation) => mutateWithAudit(db, mutation),
  compensate: compensateDepublicizationFenceOnD1Failure,
  rethrowFrameworkControl: unstable_rethrow,
  isAuditMutationError: (error) => error instanceof AuditMutationError,
  rereadStatus: async (db, videoId) => {
    const row = (
      await db
        .select({ visibility_status: videos.visibility_status })
        .from(videos)
        .where(eq(videos.id, videoId))
        .limit(1)
    )[0];
    return row?.visibility_status;
  },
  isVisibilityPrecommitFailure,
  markPendingPublicReflection,
  log: (level, tag, details) => console[level](tag, details),
};

export function executeVideoVisibilityStatusMutation(
  input: ExecuteMutationInput,
): Promise<VideoStatusActionResult> {
  return executeVideoVisibilityStatusMutationCore(input, mutationHost);
}
