/**
 * cleanup Worker の retention 計算ロジック (純粋関数)。
 * テスト容易性のため Worker 本体から切り出している。
 */

export const HISTORY_NORMAL_DAYS_DEFAULT = 90;
export const HISTORY_LONG_AUDIT_DAYS_DEFAULT = 365;
export const MIN_HISTORY_DAYS = 7;
export const MAX_HISTORY_DAYS = 3650;

export interface RetentionDays {
  normalDays: number;
  longAuditDays: number;
}

/**
 * system_settings.history_retention_days から retention 日数を決める。
 * - 範囲外 / 異常値はデフォルトにフォールバック
 * - long_audit はデフォルト値以上を保証 (運用調査用)
 *
 * @param rawHistoryRetentionDays - DBから読んだ生値 (null/undefined/異常値も許容)
 */
export function computeRetentionDays(
  rawHistoryRetentionDays: unknown,
): RetentionDays {
  const raw = Number(rawHistoryRetentionDays ?? HISTORY_NORMAL_DAYS_DEFAULT);
  const safe = Number.isFinite(raw) && raw > 0 ? raw : HISTORY_NORMAL_DAYS_DEFAULT;
  const normalDays = Math.min(
    Math.max(Math.floor(safe), MIN_HISTORY_DAYS),
    MAX_HISTORY_DAYS,
  );
  const longAuditDays = Math.max(normalDays * 4, HISTORY_LONG_AUDIT_DAYS_DEFAULT);
  return { normalDays, longAuditDays };
}

/**
 * notification_outbox の sent/failed それぞれの cutoff 秒を計算する。
 */
export interface NotificationCutoffs {
  sentCutoff: number;
  failedCutoff: number;
}

export const SENT_TTL_SEC = 14 * 24 * 60 * 60;
export const FAILED_TTL_SEC = 30 * 24 * 60 * 60;

export function computeNotificationCutoffs(now: number): NotificationCutoffs {
  return {
    sentCutoff: now - SENT_TTL_SEC,
    failedCutoff: now - FAILED_TTL_SEC,
  };
}

/**
 * history_logs の retention_class ごとの cutoff 秒を計算する。
 */
export interface HistoryCutoffs {
  normalCutoff: number;
  longAuditCutoff: number;
}

export function computeHistoryCutoffs(
  now: number,
  days: RetentionDays,
): HistoryCutoffs {
  return {
    normalCutoff: now - days.normalDays * 24 * 60 * 60,
    longAuditCutoff: now - days.longAuditDays * 24 * 60 * 60,
  };
}

/**
 * voided 動画の後処理 cutoff 秒。現在は D1 への動画状態 UPDATE は行わない。
 */
export const VOIDED_VIDEO_HIDE_TTL_SEC = 30 * 24 * 60 * 60;

export function computeVoidedVideoHideCutoff(now: number): number {
  return now - VOIDED_VIDEO_HIDE_TTL_SEC;
}

/**
 * cleanup ジョブ全体のリトライ判定。
 * D1 の一時的エラー (ネットワーク / Throttle) は次回 cron を待たず即リトライしてよい。
 * - 試行回数が MAX_RETRIES 未満なら true
 * - throttle っぽいエラー (Too many / 429 / network) は true
 * - スキーマエラー (no such column 等) は false (リトライしても直らない)
 */
export const CLEANUP_MAX_RETRIES = 3;

export interface RetryDecision {
  shouldRetry: boolean;
  reason: string;
}

export function shouldRetryCleanupError(
  attemptCount: number,
  error: unknown,
): RetryDecision {
  if (attemptCount >= CLEANUP_MAX_RETRIES) {
    return { shouldRetry: false, reason: "max_retries_reached" };
  }
  const msg = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
  // スキーマ起因はリトライ不可
  if (
    msg.includes("no such column") ||
    msg.includes("no such table") ||
    msg.includes("syntax error")
  ) {
    return { shouldRetry: false, reason: "schema_error" };
  }
  // よく見る一時エラー
  if (
    msg.includes("too many") ||
    msg.includes("rate") ||
    msg.includes("timeout") ||
    msg.includes("network") ||
    msg.includes("429") ||
    msg.includes("503")
  ) {
    return { shouldRetry: true, reason: "transient_error" };
  }
  // 不明エラーも一旦リトライ (max を超えれば諦める)
  return { shouldRetry: true, reason: "unknown_error" };
}
