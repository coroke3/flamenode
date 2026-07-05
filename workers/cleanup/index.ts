/**
 * 期限切れスロット解放 / 古い通知削除 / 監査ログクリーンアップを担当するスケジュールワーカー。
 */
import {
  computeHistoryCutoffs,
  computeNotificationCutoffs,
  computeRetentionDays,
  computeVoidedVideoHideCutoff,
  shouldRetryCleanupError,
  CLEANUP_MAX_RETRIES,
  HISTORY_NORMAL_DAYS_DEFAULT,
  HISTORY_LONG_AUDIT_DAYS_DEFAULT,
  type RetentionDays,
} from "./retention.ts";

export interface Env {
  DB: D1Database;
}

export default {
  async scheduled(_evt: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCleanupWithRetry(env));
  },
  async fetch(): Promise<Response> {
    return new Response("FlameNode cleanup", { status: 200 });
  },
};

/**
 * runCleanup を最大 CLEANUP_MAX_RETRIES 回まで即時リトライする。
 */
export async function runCleanupWithRetry(env: Env): Promise<void> {
  let attempt = 0;
  let lastError: unknown = null;
  while (attempt < CLEANUP_MAX_RETRIES) {
    try {
      await runCleanup(env);
      return;
    } catch (e) {
      attempt += 1;
      lastError = e;
      const decision = shouldRetryCleanupError(attempt, e);
      console.error(
        `[cleanup] attempt=${attempt} failed (${decision.reason}):`,
        e,
      );
      if (!decision.shouldRetry) break;
      await new Promise((r) => setTimeout(r, 100 * attempt));
    }
  }
  console.error(
    `[cleanup] gave up after ${attempt} attempt(s). last_error=`,
    lastError,
  );
}

export async function readHistoryRetentionDays(env: Env): Promise<RetentionDays> {
  try {
    const row = await env.DB.prepare(
      `SELECT history_retention_days FROM system_settings LIMIT 1`,
    ).first<{ history_retention_days: number | null }>();
    return computeRetentionDays(row?.history_retention_days);
  } catch {
    return {
      normalDays: HISTORY_NORMAL_DAYS_DEFAULT,
      longAuditDays: HISTORY_LONG_AUDIT_DAYS_DEFAULT,
    };
  }
}

export async function runCleanup(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const retentionDays = await readHistoryRetentionDays(env);
  const { sentCutoff, failedCutoff } = computeNotificationCutoffs(now);
  const { normalCutoff, longAuditCutoff } = computeHistoryCutoffs(now, retentionDays);
  const voidedHideCutoff = computeVoidedVideoHideCutoff(now);

  await env.DB.prepare(
    `UPDATE slots
     SET priority_reclaim_until = NULL, updated_at = ?1
     WHERE priority_reclaim_until IS NOT NULL AND priority_reclaim_until < ?1`,
  )
    .bind(now)
    .run();

  await env.DB.prepare(
    `DELETE FROM notification_outbox
     WHERE status = 'sent' AND created_at IS NOT NULL AND created_at < ?1`,
  )
    .bind(sentCutoff)
    .run();

  await env.DB.prepare(
    `DELETE FROM notification_outbox
     WHERE status = 'failed' AND created_at IS NOT NULL AND created_at < ?1`,
  )
    .bind(failedCutoff)
    .run();

  // audit_logs: 新正本 — expires_at インデックスを使い小分け削除
  const { AUDIT_CLEANUP_BATCH_LIMIT } = await import("./retention.ts");

  const expiredMark = await env.DB.prepare(
    `UPDATE audit_logs
     SET restore_status = 'expired'
     WHERE restore_status = 'restorable'
       AND expires_at IS NOT NULL
       AND expires_at < ?1
     LIMIT ?2`,
  )
    .bind(now, AUDIT_CLEANUP_BATCH_LIMIT)
    .run();

  const expiredDelete = await env.DB.prepare(
    `DELETE FROM audit_logs
     WHERE expires_at IS NOT NULL
       AND expires_at < ?1
     LIMIT ?2`,
  )
    .bind(now, AUDIT_CLEANUP_BATCH_LIMIT)
    .run();

  // compact: 古いログの before/after を軽量化 (復元不可化)
  let compactCutoff = now - 30 * 86400;
  try {
    const settingsRow = await env.DB.prepare(
      `SELECT compact_after_days FROM audit_log_settings WHERE id = 'default' LIMIT 1`,
    ).first<{ compact_after_days: number | null }>();
    const days = Number(settingsRow?.compact_after_days ?? 30);
    if (Number.isFinite(days) && days > 0) {
      compactCutoff = now - Math.floor(days) * 86400;
    }
  } catch {
    // audit_log_settings 未作成時はデフォルト 30 日
  }

  await env.DB.prepare(
    `UPDATE audit_logs
     SET before_json = NULL,
         after_json = NULL,
         inverse_patch_json = NULL,
         restore_status = CASE
           WHEN restore_status = 'restorable' THEN 'not_restorable'
           ELSE restore_status
         END
     WHERE created_at < ?1
       AND (before_json IS NOT NULL OR after_json IS NOT NULL)
     LIMIT ?2`,
  )
    .bind(compactCutoff, AUDIT_CLEANUP_BATCH_LIMIT)
    .run();

  void voidedHideCutoff;
  void expiredMark;
  void expiredDelete;
}
