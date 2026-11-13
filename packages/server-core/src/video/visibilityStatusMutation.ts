import type { BatchItem } from "drizzle-orm/batch";
import { SAME_VIDEO_STATUS_MESSAGE } from "@flamenode/domain/video";
import type { WriteAuditLogInput } from "../audit/types.ts";
import type { QueueWakeSource } from "../queues/wakeBudget.ts";
import type { VideoVisibilityTransitionPlan } from "../visibility/videoTransition.ts";

export type VideoStatusActionResult = {
  ok: boolean;
  message?: string;
  errorCode?: string;
  traceId?: string;
  retryable?: boolean;
  pendingPublicReflection?: boolean;
  nextHref?: string;
};

export type ExecuteVideoVisibilityStatusMutationInput<DB> = {
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

type MutationPayload = {
  mutationStatements: BatchItem<"sqlite">[];
  expectedMutationChanges: (number | null)[];
  audits: WriteAuditLogInput[];
  notificationWakeSource?: QueueWakeSource;
  staticRebuildWakeSource?: QueueWakeSource;
};

export type VideoVisibilityStatusMutationHost<DB> = {
  createTraceId(): string;
  preCommit(input: { videoId: string; fenceToken: string; reason: string | null }): Promise<void>;
  mutate(db: DB, input: MutationPayload): Promise<unknown>;
  compensate(
    db: DB,
    input: {
      videoId: string;
      fenceToken: string;
      traceId: string;
      allowNonPublicRollback: boolean;
    },
  ): Promise<void>;
  rethrowFrameworkControl(error: unknown): void;
  isAuditMutationError(error: unknown): boolean;
  rereadStatus(db: DB, videoId: string): Promise<string | null | undefined>;
  isVisibilityPrecommitFailure(error: unknown): boolean;
  markPendingPublicReflection<T extends { ok: boolean }>(
    result: T,
    enqueued: boolean,
  ): T & { pendingPublicReflection?: boolean };
  log(
    level: "error" | "warn",
    tag: string,
    details: Record<string, unknown>,
  ): void;
};

/**
 * Framework-neutral execution boundary for SA-001..003 / SA-040..042.
 * The caller supplies its audit/wake adapter and R2 fence host; the ordering
 * and failure semantics remain shared between CURRENT and Hono.
 */
export async function executeVideoVisibilityStatusMutation<DB>(
  input: ExecuteVideoVisibilityStatusMutationInput<DB>,
  host: VideoVisibilityStatusMutationHost<DB>,
): Promise<VideoStatusActionResult> {
  const traceId = host.createTraceId();
  const {
    db,
    videoId,
    requestedStatus,
    transition,
    reason,
    logTag,
  } = input;

  if (transition.validationError) {
    return { ok: false, message: transition.validationError };
  }

  // The planner returns notification INSERTs separately from its video/fence
  // and static-rebuild statements. They must enter this SAME audited D1 batch;
  // a wake source alone does not persist an outbox row.
  const mutationStatements = [
    ...transition.mutationStatements,
    ...transition.notificationBatch.statements,
    ...(input.extraStatements ?? []),
  ];
  const expectedMutationChanges = [
    ...transition.expectedMutationChanges,
    ...transition.notificationBatch.expectedChanges,
    ...(input.extraExpected ?? []),
  ];
  const audits = [...transition.audits, ...(input.extraAudits ?? [])];

  try {
    if (transition.fenceToken) {
      await host.preCommit({
        videoId,
        fenceToken: transition.fenceToken,
        reason,
      });
    }

    await host.mutate(db, {
      mutationStatements,
      expectedMutationChanges,
      audits,
      notificationWakeSource: input.notificationWakeSource,
      staticRebuildWakeSource: input.staticRebuildWakeSource,
    });
  } catch (error) {
    host.rethrowFrameworkControl(error);
    if (transition.fenceToken) {
      try {
        await host.compensate(db, {
          videoId,
          fenceToken: transition.fenceToken,
          traceId,
          allowNonPublicRollback: !transition.depublicizedFromPublic,
        });
      } catch {
        // Provider/D1/R2 exceptions can contain SQL, request bodies or
        // credentials. Do not send exception objects to console adapters.
        host.log("warn", `[${logTag}] visibility compensation failed`, {
          traceId,
          error_code: "visibility_compensation_failed",
        });
      }
    }
    if (host.isAuditMutationError(error)) {
      const currentStatus = await host.rereadStatus(db, videoId);
      if (currentStatus === requestedStatus) {
        return host.markPendingPublicReflection(
          { ok: true, message: "すでに同じ状態へ更新されています。" },
          false,
        );
      }
      return {
        ok: false,
        message: "別の担当者が状態を変更しました。状態を再取得してもう一度お試しください。",
        errorCode: "concurrent_update",
        traceId,
        retryable: true,
      };
    }
    if (host.isVisibilityPrecommitFailure(error)) {
      host.log("error", `[${logTag}] visibility precommit failed`, {
        traceId, error_code: "visibility_precommit_failed",
      });
      return {
        ok: false,
        message: "公開ブロックの記録に失敗しました。",
        errorCode: "visibility_precommit_failed",
        traceId,
        retryable: false,
      };
    }
    host.log("error", `[${logTag}] mutation failed`, {
      traceId, error_code: "mutation_failed",
    });
    return {
      ok: false,
      message: `承認処理に失敗しました。状態を再取得してもう一度お試しください。エラーID: ${traceId}`,
      errorCode: "mutation_failed",
      traceId,
      retryable: true,
    };
  }

  return host.markPendingPublicReflection(
    { ok: true, message: "ステータスを更新しました。" },
    transition.queueBatch.statements.length > 0,
  );
}
