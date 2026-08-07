import { unstable_rethrow } from "next/navigation";
import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { AuditMutationError, mutateWithAudit } from "@/lib/audit/mutate";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import type { DB } from "@/lib/db/client";
import { videos } from "@/lib/db/schema";
import { createTraceId } from "@/lib/observability/flowTrace";
import type { QueueWakeSource } from "@/lib/queues/wakeBudget";
import { markPendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";
import type { PendingPublicReflection } from "@/lib/staticRebuild/publicReflectionNotice";
import {
  preCommitVideoVisibilityDepublicization,
  type VideoVisibilityTransitionPlan,
} from "@/lib/video/videoVisibilityTransition";
import { SAME_VIDEO_STATUS_MESSAGE } from "@/lib/video/videoVisibilityStatusCore";

export type VideoStatusActionResult = PendingPublicReflection & {
  ok: boolean;
  message?: string;
  errorCode?: string;
  traceId?: string;
  retryable?: boolean;
  nextHref?: string;
};

export {
  SAME_VIDEO_STATUS_MESSAGE,
  loadVideoRebuildEventIds,
  mergeVideoRebuildEventIds,
  monotonicVideoUpdatedAt,
} from "@/lib/video/videoVisibilityStatusCore";

type ExecuteMutationInput = {
  db: DB;
  videoId: string;
  requestedStatus: string;
  transition: VideoVisibilityTransitionPlan;
  reason: string | null;
  logTag: string;
  extraStatements?: BatchItem<"sqlite">[];
  extraExpected?: (number | null)[];
  extraAudits?: WriteAuditLogInput[];
  notificationWakeSource?: QueueWakeSource;
  staticRebuildWakeSource?: QueueWakeSource;
};

export async function executeVideoVisibilityStatusMutation(
  input: ExecuteMutationInput,
): Promise<VideoStatusActionResult> {
  const traceId = createTraceId();
  const {
    db,
    videoId,
    requestedStatus,
    transition,
    reason,
    logTag,
  } = input;

  const statements = [
    ...transition.mutationStatements,
    ...(input.extraStatements ?? []),
  ];
  const expected = [
    ...transition.expectedMutationChanges,
    ...(input.extraExpected ?? []),
  ];
  const audits = [...transition.audits, ...(input.extraAudits ?? [])];

  try {
    if (transition.depublicizedFromPublic && transition.fenceToken) {
      await preCommitVideoVisibilityDepublicization({
        videoId,
        fenceToken: transition.fenceToken,
        reason,
      });
    }

    await mutateWithAudit(db, {
      mutationStatements: statements,
      expectedMutationChanges: expected,
      audits,
      notificationWakeSource: input.notificationWakeSource,
      staticRebuildWakeSource: input.staticRebuildWakeSource,
    });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AuditMutationError) {
      const reread = (
        await db.select().from(videos).where(eq(videos.id, videoId)).limit(1)
      )[0];
      if (reread?.visibility_status === requestedStatus) {
        return markPendingPublicReflection(
          { ok: true, message: SAME_VIDEO_STATUS_MESSAGE },
          false,
        );
      }
      return {
        ok: false,
        message:
          "別の担当者が状態を変更しました。状態を再取得してもう一度お試しください。",
        errorCode: "concurrent_update",
        traceId,
        retryable: true,
      };
    }
    console.error(`[${logTag}] mutation failed`, { traceId, error });
    return {
      ok: false,
      message: `承認処理に失敗しました。状態を再取得してもう一度お試しください。エラーID: ${traceId}`,
      errorCode: "mutation_failed",
      traceId,
      retryable: true,
    };
  }

  return markPendingPublicReflection(
    { ok: true, message: "ステータスを更新しました。" },
    transition.queueBatch.statements.length > 0,
  );
}
