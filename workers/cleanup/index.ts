/**
 * 期限切れスロット解放 / 古い通知削除 / 監査ログのアーカイブを担当するスケジュールワーカー。
 * 設計の `cleanup` ジョブに対応。
 */
export interface Env {
  DB: D1Database;
}

// notification_outbox.sent は 14 日保持、failed は 30 日保持してから削除。
// failed のほうが長いのは、運用調査・通知失敗履歴の手動確認余地を残すため。
const SENT_TTL_SEC = 14 * 24 * 60 * 60;
const FAILED_TTL_SEC = 30 * 24 * 60 * 60;

// history_logs: retention_class=normal は system_settings.history_retention_days を参照 (デフォルト 90 日)。
// long_audit は normal の 4 倍を基準 (デフォルト 365 日) とする。
const HISTORY_NORMAL_DAYS_DEFAULT = 90;
const HISTORY_LONG_AUDIT_DAYS_DEFAULT = 365;
const MIN_HISTORY_DAYS = 7;
const MAX_HISTORY_DAYS = 3650;

// voided 状態の動画は 30 日後に is_deleted を 1 に統一する (論理削除の整合化)。
// 物理削除は行わず、操作した admin が決めた void_reason などのフィールドはそのまま保持する。
const VOIDED_VIDEO_HIDE_TTL_SEC = 30 * 24 * 60 * 60;

export default {
  async scheduled(_evt: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCleanup(env));
  },
  async fetch(): Promise<Response> {
    return new Response("FlameNode cleanup", { status: 200 });
  },
};

async function readHistoryRetentionDays(env: Env): Promise<{
  normalDays: number;
  longAuditDays: number;
}> {
  try {
    const row = await env.DB.prepare(
      `SELECT history_retention_days FROM system_settings LIMIT 1`,
    ).first<{ history_retention_days: number | null }>();
    const raw = Number(row?.history_retention_days ?? HISTORY_NORMAL_DAYS_DEFAULT);
    const safe = Number.isFinite(raw) && raw > 0 ? raw : HISTORY_NORMAL_DAYS_DEFAULT;
    const normalDays = Math.min(Math.max(Math.floor(safe), MIN_HISTORY_DAYS), MAX_HISTORY_DAYS);
    // long_audit はデフォルト値以上を保証 (運用調査に必要なため normal より短くしない)。
    const longAuditDays = Math.max(normalDays * 4, HISTORY_LONG_AUDIT_DAYS_DEFAULT);
    return { normalDays, longAuditDays };
  } catch {
    return {
      normalDays: HISTORY_NORMAL_DAYS_DEFAULT,
      longAuditDays: HISTORY_LONG_AUDIT_DAYS_DEFAULT,
    };
  }
}

async function runCleanup(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const { normalDays, longAuditDays } = await readHistoryRetentionDays(env);

  // 期限切れの slot.priority_reclaim_until を解放
  await env.DB.prepare(
    `UPDATE slots
     SET priority_reclaim_until = NULL, updated_at = ?1
     WHERE priority_reclaim_until IS NOT NULL AND priority_reclaim_until < ?1`,
  )
    .bind(now)
    .run();

  // 期限切れ x_reapply_required スロットを voided へ
  await env.DB.prepare(
    `UPDATE slots
     SET status = 'voided', updated_at = ?1
     WHERE status = 'x_reapply_required' AND deadline_at IS NOT NULL AND deadline_at < ?1`,
  )
    .bind(now)
    .run();

  // notification_outbox: 完了済みを TTL に従って削除
  const sentCutoff = now - SENT_TTL_SEC;
  await env.DB.prepare(
    `DELETE FROM notification_outbox
     WHERE status = 'sent' AND created_at IS NOT NULL AND created_at < ?1`,
  )
    .bind(sentCutoff)
    .run();

  const failedCutoff = now - FAILED_TTL_SEC;
  await env.DB.prepare(
    `DELETE FROM notification_outbox
     WHERE status = 'failed' AND created_at IS NOT NULL AND created_at < ?1`,
  )
    .bind(failedCutoff)
    .run();

  // history_logs: retention_class ごとに TTL 削除
  const historyNormalCutoff = now - normalDays * 24 * 60 * 60;
  await env.DB.prepare(
    `DELETE FROM history_logs
     WHERE (retention_class IS NULL OR retention_class = 'normal')
       AND created_at < ?1`,
  )
    .bind(historyNormalCutoff)
    .run();

  const historyAuditCutoff = now - longAuditDays * 24 * 60 * 60;
  await env.DB.prepare(
    `DELETE FROM history_logs
     WHERE retention_class = 'long_audit'
       AND created_at < ?1`,
  )
    .bind(historyAuditCutoff)
    .run();

  // voided 動画: voided_at から 30 日経過していたら is_deleted=1 を補正する。
  // setVideoStatus は voided 時点で is_deleted=1 を立てているが、過去データの整合化を兼ねる。
  const voidedHideCutoff = now - VOIDED_VIDEO_HIDE_TTL_SEC;
  await env.DB.prepare(
    `UPDATE videos
     SET is_deleted = 1, updated_at = ?1
     WHERE status = 'voided'
       AND is_deleted = 0
       AND voided_at IS NOT NULL
       AND voided_at < ?2`,
  )
    .bind(now, voidedHideCutoff)
    .run();
}
