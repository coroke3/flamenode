import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { auditLogs, auditRestoreRuns, users } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import { getAdapter } from "./adapters";
import { evaluateRestoreCapability } from "./capability";
import { assertChanges, mutateWithAudit } from "./mutate";
import { computeChangedKeys } from "./snapshot";
import {
  AuditOperation,
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
  if (log.expires_at !== null && log.expires_at < now) {
    return { ok: false, message: "このログの復元可能期間は終了しています。" };
  }

  const strategy = log.restore_strategy as RestoreStrategy;
  const before = parseSnapshot(log.before_json);
  const after = parseSnapshot(log.after_json);
  const capability = evaluateRestoreCapability({
    tableName: log.table_name,
    strategy,
    before,
    after,
    payloadExceeded: false,
  });
  if (!capability.restorable) {
    return { ok: false, message: capability.message };
  }

  const adapter = getAdapter(log.table_name);
  if (!adapter) return { ok: false, message: "復元アダプターが見つかりません。" };
  const target = strategy === RestoreStrategy.delete_created ? after : before;
  if (!target) return { ok: false, message: "復元用スナップショットがありません。" };

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
  if (conflicts.length && !forceOverwrite) {
    return {
      ok: false,
      message: `競合が検出されました: ${conflicts.join(", ")}。`,
      diff: { current, target, conflicts },
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
    return { ok: false, message: error instanceof Error ? error.message : "復元mutationを作成できません。" };
  }

  const restoreRunId = generateId("rst");
  try {
    await mutateWithAudit(db, {
      mutationStatements: [restoreMutation.query],
      expectedMutationChanges: restoreMutation.expectedChanges,
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
    return {
      ok: false,
      message: `復元を確定できませんでした。変更はロールバックされました: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return { ok: true, message: "復元が完了しました。", restore_run_id: restoreRunId };
}
