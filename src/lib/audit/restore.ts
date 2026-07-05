import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { auditLogs, auditRestoreRuns, users } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import type { RestoreOptions, RestoreResult } from "./types";
import { AuditOperation, RestoreStatus } from "./types";
import { getAdapter, RESTORABLE_TABLES } from "./adapters";
import { writeAuditLog } from "./logger";
import { computeChangedKeys } from "./snapshot";

// ============================================================
// restoreAuditLog
// ============================================================

/**
 * 指定した監査ログエントリを元に、対象レコードを以前の状態に復元する。
 *
 * - 管理者権限チェック
 * - ログの存在・restorable 判定
 * - 期限切れチェック
 * - アダプター取得 (ホワイトリスト外は拒否)
 * - 競合チェック (after_json vs 現行レコード)
 * - dry_run モード対応
 * - 復元実行
 * - RESTORE 監査ログ書き込み
 * - 元ログの restore_status を restored に更新
 * - audit_restore_runs にレコード挿入
 */
export async function restoreAuditLog(
  db: DB,
  options: RestoreOptions,
): Promise<RestoreResult> {
  const { auditId, userId, reason, forceOverwrite = false, dry_run = false, confirmText } = options;

  if (!dry_run) {
    const required = `RESTORE ${auditId}`;
    if (!confirmText || confirmText.trim() !== required) {
      return {
        ok: false,
        message: `確認テキストが正しくありません。「${required}」と入力してください。`,
      };
    }
    if (!reason.trim()) {
      return { ok: false, message: "復元理由の入力が必要です。" };
    }
  }

  // 管理者チェック
  const user = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (!user || user.role !== "admin") {
    return { ok: false, message: "管理者のみリストアを実行できます。" };
  }

  // 監査ログを取得
  const log = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.id, auditId))
    .get();

  if (!log) {
    return { ok: false, message: "監査ログが見つかりません。" };
  }

  // restorable 判定
  if (log.restore_status !== RestoreStatus.restorable) {
    return {
      ok: false,
      message: `このログはリストアできません (status: ${log.restore_status})。`,
    };
  }

  // 期限切れチェック
  const now = Math.floor(Date.now() / 1000);
  if (log.expires_at !== null && log.expires_at < now) {
    await db
      .update(auditLogs)
      .set({ restore_status: RestoreStatus.expired })
      .where(eq(auditLogs.id, auditId));
    return { ok: false, message: "このログの保持期限が切れています。" };
  }

  // ホワイトリストチェック
  if (!RESTORABLE_TABLES.has(log.table_name)) {
    return {
      ok: false,
      message: `テーブル "${log.table_name}" はリストア対象外です。`,
    };
  }

  // アダプター取得
  const adapter = getAdapter(log.table_name);
  if (!adapter) {
    return {
      ok: false,
      message: `テーブル "${log.table_name}" のアダプターが見つかりません。`,
    };
  }

  const strategy = log.restore_strategy as import("./types").RestoreStrategy;

  // 復元データ: update_before / recreate_deleted は before、delete_created は after
  let restoreTarget: Record<string, unknown> | null = null;
  const sourceJson =
    strategy === "delete_created" ? log.after_json : log.before_json;
  if (!sourceJson) {
    return {
      ok: false,
      message: "リストアに必要なスナップショットデータが存在しません。",
    };
  }
  try {
    restoreTarget = JSON.parse(sourceJson) as Record<string, unknown>;
  } catch {
    return { ok: false, message: "スナップショットデータの解析に失敗しました。" };
  }

  // 現行レコードを取得
  const current = await adapter.fetchCurrent(db, log.target_id);

  // after_json から期待する状態を解析
  let afterData: Record<string, unknown> | null = null;
  if (log.after_json) {
    try {
      afterData = JSON.parse(log.after_json) as Record<string, unknown>;
    } catch {
      // 無視
    }
  }

  // 競合チェック: 現行レコードと after_json が一致するか
  const conflicts: string[] = [];
  if (current && afterData && !forceOverwrite) {
    const changedSince = computeChangedKeys(afterData, current);
    conflicts.push(...changedSince);
  }

  if (dry_run) {
    return {
      ok: true,
      message: conflicts.length > 0
        ? `競合キー: ${conflicts.join(", ")}`
        : "競合なし。リストア可能です。",
      diff: {
        current,
        target: restoreTarget,
        conflicts,
      },
    };
  }

  // 競合があり forceOverwrite=false なら拒否
  if (conflicts.length > 0 && !forceOverwrite) {
    return {
      ok: false,
      message: `競合が検出されました。変更されたキー: ${conflicts.join(", ")}。強制上書きするには forceOverwrite=true を使用してください。`,
      diff: {
        current,
        target: restoreTarget,
        conflicts,
      },
    };
  }

  // リストア実行
  const restoreRunId = generateId("rst");
  try {
    await adapter.applyRestore(db, restoreTarget, strategy, {
      forceOverwrite,
      actorUserId: userId,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await db
      .update(auditLogs)
      .set({ restore_status: RestoreStatus.failed })
      .where(eq(auditLogs.id, auditId));

    await db.insert(auditRestoreRuns).values({
      id: restoreRunId,
      audit_log_id: auditId,
      executed_by_user_id: userId,
      reason,
      status: "failed",
      error_message: errMsg,
      executed_at: now,
    });

    return { ok: false, message: `リストア実行中にエラーが発生しました: ${errMsg}` };
  }

  // 元ログを restored に更新
  await db
    .update(auditLogs)
    .set({ restore_status: RestoreStatus.restored })
    .where(eq(auditLogs.id, auditId));

  // audit_restore_runs に記録
  await db.insert(auditRestoreRuns).values({
    id: restoreRunId,
    audit_log_id: auditId,
    executed_by_user_id: userId,
    reason,
    status: "success",
    error_message: null,
    executed_at: now,
  });

  // RESTORE 監査ログ書き込み
  await writeAuditLog(db, {
    table_name: log.table_name,
    target_id: log.target_id,
    operation: AuditOperation.RESTORE,
    before: current,
    after: restoreTarget,
    actor_user_id: userId,
    reason,
    retention_class: "long_audit",
    context: "restore",
  }).catch(() => {
    // RESTORE ログ書き込み失敗は致命的ではないので無視
  });

  return {
    ok: true,
    message: "リストアが完了しました。",
    restore_run_id: restoreRunId,
  };
}
