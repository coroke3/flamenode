import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { auditLogs, auditRestoreRuns, users } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { evaluateRestoreCapability } from "./capability";
import { assertChanges, mutateWithAudit } from "./mutate";
import { getRestoreRegistration } from "./registry";
import { computeChangedKeys } from "./snapshot";
import {
  AuditOperation,
  RestoreFailureReason,
  RestoreStatus,
  RestoreStrategy,
  type RestoreOptions,
  type RestoreResult,
} from "./types";

function parseSnapshot(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const PERMANENT_RESTORE_REASONS = new Set([
  "payload_exceeded",
  "strategy_none",
  "strategy_unsupported",
  "adapter_missing",
  "before_missing",
  "after_missing",
  "snapshot_invalid",
  "snapshot_redacted",
  "primary_key_missing",
  "event_id_missing",
  "event_staff_subject_missing",
  "required_field_missing",
]);

function sanitizeRestoreError(
  error: unknown,
): string {
  const raw =
    error instanceof Error
      ? error.message
      : String(error);

  return raw
    .replace(
      /(token|secret|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .slice(0, 1000);
}

async function persistFailedRestoreRun(args: {
  db: DB;
  auditId: string;
  userId: string;
  reason: string;
  reasonCode: string;
  message: string;
  now: number;
}): Promise<string> {
  const runId = generateId("rst");

  await args.db.insert(auditRestoreRuns).values({
    id: runId,
    audit_log_id: args.auditId,
    executed_by_user_id: args.userId,
    reason: args.reason,
    status: "failed",
    error_message: JSON.stringify({
      code: args.reasonCode,
      message: sanitizeRestoreError(args.message),
    }),
    executed_at: args.now,
  });

  return runId;
}

async function persistPermanentRestoreFailure(args: {
  db: DB;
  auditId: string;
  userId: string;
  reason: string;
  reasonCode: string;
  message: string;
  now: number;
  status?: RestoreStatus;
}): Promise<string> {
  const runId = generateId("rst");
  const status =
    args.status ?? RestoreStatus.not_restorable;

  await args.db.batch([
    args.db
      .update(auditLogs)
      .set({
        restore_status: status,
        restore_unavailable_reason_code:
          args.reasonCode,
        restore_unavailable_message:
          sanitizeRestoreError(args.message),
      })
      .where(eq(auditLogs.id, args.auditId)),
    args.db.run(assertChanges(1)),
    args.db.insert(auditRestoreRuns).values({
      id: runId,
      audit_log_id: args.auditId,
      executed_by_user_id: args.userId,
      reason: args.reason,
      status: "failed",
      error_message: JSON.stringify({
        code: args.reasonCode,
        message: sanitizeRestoreError(args.message),
      }),
      executed_at: args.now,
    }),
    args.db.run(assertChanges(1)),
  ]);

  return runId;
}

/**
 * 復元本体、復元履歴、元ログの状態更新、RESTORE 監査ログを単一 D1 batch で確定する。
 * いずれか一つでも失敗した場合は、復元対象を含めて全て rollback される。
 */
export async function restoreAuditLog(
  db: DB,
  options: RestoreOptions,
): Promise<RestoreResult> {
  const { auditId, userId, reason, forceOverwrite = false, dry_run = false, confirmText } = options;
  if (!dry_run && confirmText?.trim() !== `RESTORE ${auditId}`) {
    return { ok: false, message: `確認テキスト「RESTORE ${auditId}」を入力してください。` };
  }
  if (!dry_run && !reason.trim()) {
    return { ok: false, message: "復元理由を入力してください。" };
  }

  const user = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).get();
  if (!user || user.role !== "admin") {
    return { ok: false, message: "site admin のみ監査ログを復元できます。" };
  }

  const log = await db.select().from(auditLogs).where(eq(auditLogs.id, auditId)).get();
  if (!log) return { ok: false, message: "監査ログが見つかりません。" };

  const priorSuccess = await db
    .select({ id: auditRestoreRuns.id })
    .from(auditRestoreRuns)
    .where(
      and(
        eq(auditRestoreRuns.audit_log_id, auditId),
        eq(auditRestoreRuns.status, "success"),
      )!,
    )
    .limit(1)
    .get();
  if (priorSuccess) {
    return { ok: false, message: "この監査ログはすでに復元済みです。" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (
    log.expires_at !== null &&
    log.expires_at < now
  ) {
    const message =
      "このログの復元可能期間は終了しています。";

    if (dry_run) {
      return {
        ok: false,
        message,
        reason_code: RestoreFailureReason.expired,
        restore_status: RestoreStatus.expired,
      };
    }

    const runId =
      await persistPermanentRestoreFailure({
        db,
        auditId,
        userId,
        reason,
        reasonCode:
          RestoreFailureReason.expired,
        message,
        now,
        status: RestoreStatus.expired,
      });

    return {
      ok: false,
      message,
      reason_code: RestoreFailureReason.expired,
      restore_status: RestoreStatus.expired,
      restore_run_id: runId,
    };
  }

  const strategy = log.restore_strategy as RestoreStrategy;
  const payloadExceeded =
    log.restore_unavailable_reason_code === "payload_exceeded";
  const before = parseSnapshot(log.before_json);
  const after = parseSnapshot(log.after_json);
  const capability = evaluateRestoreCapability({
    tableName: log.table_name,
    strategy,
    before,
    after,
    payloadExceeded,
  });
  if (!capability.restorable) {
    if (dry_run) {
      return {
        ok: false,
        message: capability.message,
        reason_code: capability.reasonCode,
        restore_status: capability.status,
      };
    }

    const permanent =
      PERMANENT_RESTORE_REASONS.has(
        capability.reasonCode,
      );

    const runId = permanent
      ? await persistPermanentRestoreFailure({
          db,
          auditId,
          userId,
          reason,
          reasonCode: capability.reasonCode,
          message: capability.message,
          now,
        })
      : await persistFailedRestoreRun({
          db,
          auditId,
          userId,
          reason,
          reasonCode: capability.reasonCode,
          message: capability.message,
          now,
        });

    return {
      ok: false,
      message: capability.message,
      reason_code: capability.reasonCode,
      restore_status: capability.status,
      restore_run_id: runId,
    };
  }

  const registration =
    getRestoreRegistration(log.table_name);

  if (!registration) {
    const message =
      "復元アダプターが見つかりません。";

    if (dry_run) {
      return {
        ok: false,
        message,
        reason_code:
          RestoreFailureReason.adapterMissing,
      };
    }

    const runId =
      await persistPermanentRestoreFailure({
        db,
        auditId,
        userId,
        reason,
        reasonCode:
          RestoreFailureReason.adapterMissing,
        message,
        now,
      });

    return {
      ok: false,
      message,
      reason_code:
        RestoreFailureReason.adapterMissing,
      restore_run_id: runId,
    };
  }

  const adapter = registration.adapter;
  const target = strategy === RestoreStrategy.delete_created ? after : before;
  if (!target) return { ok: false, message: "復元用スナップショットがありません。" };
  if (target.id !== log.target_id) {
    return { ok: false, message: "監査対象IDがスナップショットと一致しません。" };
  }

  const current = await adapter.fetchCurrent(db, log.target_id);
  const conflicts: string[] = [];
  if (strategy === RestoreStrategy.recreate_deleted) {
    if (current) conflicts.push("target_already_exists");
  } else if (!current) {
    conflicts.push("target_missing");
  } else if (after) {
    conflicts.push(...computeChangedKeys(after, current));
  }

  if (dry_run) {
    return {
      ok: true,
      message: conflicts.length ? `競合あり: ${conflicts.join(", ")}` : "競合なし。復元可能です。",
      diff: { current, target, conflicts },
    };
  }
  if (
    conflicts.length > 0 &&
    !forceOverwrite
  ) {
    const message =
      `競合が検出されました: ${conflicts.join(", ")}。`;

    const runId =
      await persistFailedRestoreRun({
        db,
        auditId,
        userId,
        reason,
        reasonCode:
          RestoreFailureReason.targetConflict,
        message,
        now,
      });

    return {
      ok: false,
      message,
      reason_code:
        RestoreFailureReason.targetConflict,
      restore_status: log.restore_status,
      restore_run_id: runId,
      diff: {
        current,
        target,
        conflicts,
      },
    };
  }

  let restoreMutation;
  try {
    restoreMutation = adapter.buildRestoreMutation(db, target, strategy, {
      forceOverwrite,
      actorUserId: userId,
      expectedCurrent: current,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "復元mutationを作成できません。";

    if (dry_run) {
      return {
        ok: false,
        message,
        reason_code:
          RestoreFailureReason.mutationFailed,
      };
    }

    const runId =
      await persistFailedRestoreRun({
        db,
        auditId,
        userId,
        reason,
        reasonCode:
          RestoreFailureReason.mutationFailed,
        message,
        now,
      });

    return {
      ok: false,
      message,
      reason_code:
        RestoreFailureReason.mutationFailed,
      restore_run_id: runId,
    };
  }

  const restoreStatements =
    restoreMutation.statements != null
      ? restoreMutation.statements
      : [restoreMutation.query];

  const restoreExpectedChanges =
    restoreMutation.expectedMutationChanges != null
      ? restoreMutation.expectedMutationChanges
      : restoreMutation.expectedChanges;

  const restoreRunId = generateId("rst");
  try {
    await mutateWithAudit(db, {
      mutationStatements: restoreStatements,
      expectedMutationChanges:
        restoreExpectedChanges,
      audits: [{
        table_name: log.table_name,
        target_id: log.target_id,
        operation: AuditOperation.RESTORE,
        before: current,
        after: target,
        actor_user_id: userId,
        reason,
        context: `restore:${auditId}`,
        retention_class: "long_audit",
        restore_strategy: RestoreStrategy.none,
        strict: true,
      }],
      postAuditStatements: [
        db.update(auditLogs)
          .set({ restore_status: RestoreStatus.restored })
          .where(and(eq(auditLogs.id, auditId), sql`${auditLogs.restore_status} <> 'restored'`)!),
        db.run(assertChanges(1)),
        db.insert(auditRestoreRuns).values({
          id: restoreRunId,
          audit_log_id: auditId,
          executed_by_user_id: userId,
          reason,
          status: "success",
          error_message: null,
          executed_at: now,
        }),
        db.run(assertChanges(1)),
      ],
    });
  } catch (error) {
    const message =
      `復元を確定できませんでした。変更はロールバックされました: ${
        sanitizeRestoreError(error)
      }`;

    let failedRunId: string | undefined;

    try {
      failedRunId =
        await persistFailedRestoreRun({
          db,
          auditId,
          userId,
          reason,
          reasonCode:
            RestoreFailureReason.mutationFailed,
          message,
          now,
        });
    } catch (recordError) {
      console.error(
        JSON.stringify({
          event: "restore_failure_record_failed",
          auditId,
          error:
            sanitizeRestoreError(recordError),
          originalError:
            sanitizeRestoreError(error),
        }),
      );
    }

    return {
      ok: false,
      message,
      reason_code:
        RestoreFailureReason.mutationFailed,
      restore_status: log.restore_status,
      restore_run_id: failedRunId,
    };
  }

  return { ok: true, message: "復元が完了しました。", restore_run_id: restoreRunId };
}
