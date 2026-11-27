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
  /** Trusted, preplanned authorization/frozen-target checks; never request JSON. */
  preMutationAssertions?: readonly BatchItem<"sqlite">[];
  extraStatements?: BatchItem<"sqlite">[];
  extraExpected?: (number | null)[];
  extraAudits?: WriteAuditLogInput[];
  notificationWakeSource?: QueueWakeSource;
  staticRebuildWakeSource?: QueueWakeSource;
};

type MutationPayload = {
  /** Runs FIRST in the same strict audited D1 batch, before any status DML. */
  preMutationAssertions?: readonly BatchItem<"sqlite">[];
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
  /**
   * Compensation can log and return after exhausting R2 CAS retries. Only a
   * fresh manifest with a real ETag and NO same-video block can certify that
   * public visibility is no longer fenced. Missing/unknown -> false or throw.
   */
  confirmCompensation(videoId: string): Promise<boolean>;
  /** Throw only a recognized framework signal; return unavailable if inspection failed. */
  rethrowFrameworkControl(error: unknown): void | "unavailable";
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

  // A provider error during R2 precommit may have committed a visibility
  // block even when its message contains no public_visibility_* marker.
  // Classify by execution phase, not by an untrusted provider error string.
  let preCommitInFlight = false;
  let compensationFailed = false;
  try {
    if (transition.fenceToken) {
      preCommitInFlight = true;
      await host.preCommit({
        videoId,
        fenceToken: transition.fenceToken,
        reason,
      });
      preCommitInFlight = false;
    }

    await host.mutate(db, {
      preMutationAssertions: input.preMutationAssertions,
      mutationStatements,
      expectedMutationChanges,
      audits,
      notificationWakeSource: input.notificationWakeSource,
      staticRebuildWakeSource: input.staticRebuildWakeSource,
    });
  } catch (error) {
    // Observability is best-effort: a failing diagnostic sink must never
    // replace the established mutation or visibility-compensation result.
    const logFailure: VideoVisibilityStatusMutationHost<DB>["log"] = (level, tag, details) => {
      try {
        host.log(level, tag, details);
      } catch {
        // Do not log the logger failure or inspect its provider error.
      }
    };
    // Next control-flow exceptions (redirect/notFound) must still propagate,
    // but only AFTER a possibly-written R2 visibility fence is compensated
    // and its removal is confirmed. Re-throwing first strands the fence.
    let frameworkControlRaised = false;
    let frameworkControlError: unknown;
    let frameworkControlUnavailable = false;
    try {
      frameworkControlUnavailable = host.rethrowFrameworkControl(error) === "unavailable";
    } catch (controlError) {
      frameworkControlRaised = true;
      frameworkControlError = controlError;
    }
    if (transition.fenceToken) {
      try {
        await host.compensate(db, {
          videoId,
          fenceToken: transition.fenceToken,
          traceId,
          allowNonPublicRollback: !transition.depublicizedFromPublic,
        });
        // A best-effort compensator may return after three unsuccessful R2
        // retries. Never interpret its void return as rollback confirmation.
        if (!(await host.confirmCompensation(videoId))) {
          throw new Error("public_visibility_manifest_compensation_unverified");
        }
      } catch {
        compensationFailed = true;
        // Provider/D1/R2 exceptions can contain SQL, request bodies or
        // credentials. Do not send exception objects to console adapters.
        logFailure("warn", `[${logTag}] visibility compensation failed`, {
          traceId,
          error_code: "visibility_compensation_failed",
        });
      }
    }
    if (frameworkControlUnavailable) {
      // Unknown framework classification cannot justify a retry or status
      // oracle, even if R2 compensation was independently confirmed.
      logFailure("warn", `[${logTag}] framework control classification unavailable`, {
        traceId, error_code: "status_framework_classification_unavailable",
      });
      return {
        ok: false,
        message: "状態の確認に失敗しました。状態を再取得してから操作してください。",
        errorCode: "status_unverified",
        traceId,
        retryable: false,
      };
    }
    if (frameworkControlRaised) {
      // Do not redirect when rollback is unverified: leave the visibility
      // state explicitly unknown and require a fresh authorized request.
      if (compensationFailed) {
        return {
          ok: false,
          message: "状態の確認に失敗しました。状態を再取得してから操作してください。",
          errorCode: "status_unverified",
          traceId,
          retryable: false,
        };
      }
      throw frameworkControlError;
    }
    // Compensation can also fail AFTER an ambiguous R2 precommit transport
    // error. In that case the request may have left a visibility fence behind
    // even though D1 mutation was never entered. Report the state as unknown,
    // not an ordinary precommit rejection: no automatic retry or status reread.
    // This also preserves the existing fail-closed post-D1 CAS behavior.
    if (compensationFailed) {
      return {
        ok: false,
        message: "状態の確認に失敗しました。状態を再取得してから操作してください。",
        errorCode: "status_unverified",
        traceId,
        retryable: false,
      };
    }
    if (preCommitInFlight) {
      logFailure("error", `[${logTag}] visibility precommit failed`, {
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
    // A guarded Hono status write re-checks live session, TOS, CostGuard,
    // event grants and linked targets in its FIRST atomic D1 statement.
    // If that batch aborts, neither a matching status reread nor a generic
    // AuditMutationError proves that authorization still holds. Treat all
    // failures with a trusted first-batch assertion as unverified and require
    // a NEW authorized request; do not expose a foreign video's current
    // status or allow an automatic CAS retry after permission revocation.
    // Unguarded CURRENT callers keep their established CAS classification.
    if (input.preMutationAssertions?.length) {
      logFailure("warn", `[${logTag}] guarded status mutation unverified`, {
        traceId, error_code: "status_guard_or_mutation_failed",
      });
      return {
        ok: false,
        message: "状態の確認に失敗しました。状態を再取得してから操作してください。",
        errorCode: "status_unverified",
        traceId,
        retryable: false,
      };
    }
    // Provider exceptions may have throwing message/coercion/prototype hooks.
    // Preserve ordinary classification order, but an uninspectable failure
    // cannot justify a status oracle or an automatic retry.
    let failureKind: "audit" | "precommit" | "mutation";
    try {
      failureKind = host.isAuditMutationError(error)
        ? "audit"
        : host.isVisibilityPrecommitFailure(error) ? "precommit" : "mutation";
    } catch {
      logFailure("warn", `[${logTag}] status failure classification unavailable`, {
        traceId, error_code: "status_failure_classification_unavailable",
      });
      return {
        ok: false,
        message: "状態の確認に失敗しました。状態を再取得してから操作してください。",
        errorCode: "status_unverified",
        traceId,
        retryable: false,
      };
    }
    if (failureKind === "audit") {
      let currentStatus: string | null | undefined;
      try {
        currentStatus = await host.rereadStatus(db, videoId);
      } catch {
        // A failed CAS followed by an unavailable D1 reread has an UNKNOWN
        // final status. Do not leak SQL/provider errors or mark it idempotent
        // or automatically retry a potentially fenced visibility transition.
        logFailure("warn", `[${logTag}] visibility status reread failed`, {
          traceId, error_code: "visibility_status_reread_failed",
        });
        return {
          ok: false,
          message: "状態の確認に失敗しました。状態を再取得してから操作してください。",
          errorCode: "status_unverified",
          traceId,
          retryable: false,
        };
      }
      if (currentStatus == null) {
        // No row is not proof of a concurrent update. The video may be
        // missing or the D1 read may have returned no result; a blind retry
        // is unsafe while an R2 visibility fence may still exist.
        logFailure("warn", `[${logTag}] visibility status missing after CAS conflict`, {
          traceId, error_code: "visibility_status_missing",
        });
        return {
          ok: false,
          message: "状態の確認に失敗しました。状態を再取得してから操作してください。",
          errorCode: "status_unverified",
          traceId,
          retryable: false,
        };
      }
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
    if (failureKind === "precommit") {
      logFailure("error", `[${logTag}] visibility precommit failed`, {
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
    logFailure("error", `[${logTag}] mutation failed`, {
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
