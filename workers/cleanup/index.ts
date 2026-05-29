/**
 * 期限切れスロット解放 / 古い通知削除 / 監査ログのアーカイブを担当するスケジュールワーカー。
 * 設計の `cleanup` ジョブに対応。
 *
 * retention 計算ロジックは `./retention.ts` に切り出されている (純粋関数)。
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
 * 一時エラーだけ拾い直し、スキーマエラーは即諦める。
 * (D1 binding は非常に短時間で復旧するため、ウォーム内のリトライで十分なケースが多い)
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
      // 100ms x attempt のごく短いバックオフ
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

  // 期限切れの slot.priority_reclaim_until を解放
  await env.DB.prepare(
    `UPDATE slots
     SET priority_reclaim_until = NULL, updated_at = ?1
     WHERE priority_reclaim_until IS NOT NULL AND priority_reclaim_until < ?1`,
  )
    .bind(now)
    .run();

  // X ID 再申請や void 対応は video_moderation_cases に寄せる。
  // slots には deadline_at / x_reapply_required / voided を持たないため、cleanup では触らない。

  // notification_outbox: 完了済みを TTL に従って削除
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

  // history_logs: retention_class ごとに TTL 削除
  await env.DB.prepare(
    `DELETE FROM history_logs
     WHERE (retention_class IS NULL OR retention_class = 'normal')
       AND created_at < ?1`,
  )
    .bind(normalCutoff)
    .run();

  await env.DB.prepare(
    `DELETE FROM history_logs
     WHERE retention_class = 'long_audit'
       AND created_at < ?1`,
  )
    .bind(longAuditCutoff)
    .run();

  // voided 動画: 無料枠防衛のため、ここでは D1 への動画状態 UPDATE を行わない。
  voidedHideCutoff;
}
