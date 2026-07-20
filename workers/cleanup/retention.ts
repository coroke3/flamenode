/** cleanup Worker の保持期限・リトライ計算。 */

export const SENT_TTL_SEC = 14 * 24 * 60 * 60;
export const FAILED_TTL_SEC = 30 * 24 * 60 * 60;
export const AUDIT_COMPACT_AFTER_DAYS_DEFAULT = 30;
export const AUDIT_CLEANUP_BATCH_LIMIT = 500;
export const CLEANUP_MAX_RETRIES = 3;

export interface NotificationCutoffs {
  sentCutoff: number;
  failedCutoff: number;
}

export interface AuditCleanupSettings {
  compactAfterDays: number;
}

export interface RetryDecision {
  shouldRetry: boolean;
  reason: string;
}

function clampPositiveInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const raw = Number(value ?? fallback);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.max(Math.floor(raw), min), max);
}

export function computeNotificationCutoffs(now: number): NotificationCutoffs {
  return {
    sentCutoff: now - SENT_TTL_SEC,
    failedCutoff: now - FAILED_TTL_SEC,
  };
}

export function normalizeAuditCleanupSettings(
  row: { audit_compact_after_days?: unknown } | null | undefined,
): AuditCleanupSettings {
  return {
    compactAfterDays: clampPositiveInteger(
      row?.audit_compact_after_days,
      1,
      365,
      AUDIT_COMPACT_AFTER_DAYS_DEFAULT,
    ),
  };
}

export function computeAuditCompactCutoff(
  now: number,
  compactAfterDays: number,
): number {
  const days = clampPositiveInteger(
    compactAfterDays,
    1,
    365,
    AUDIT_COMPACT_AFTER_DAYS_DEFAULT,
  );
  return now - days * 86400;
}

export function shouldRetryCleanupError(
  attemptCount: number,
  error: unknown,
): RetryDecision {
  if (attemptCount >= CLEANUP_MAX_RETRIES) {
    return { shouldRetry: false, reason: "max_retries_reached" };
  }
  const message = String(
    (error as { message?: unknown })?.message ?? error ?? "",
  ).toLowerCase();
  if (
    message.includes("no such column") ||
    message.includes("no such table") ||
    message.includes("syntax error")
  ) {
    return { shouldRetry: false, reason: "schema_error" };
  }
  if (
    message.includes("too many") ||
    message.includes("rate") ||
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("429") ||
    message.includes("503")
  ) {
    return { shouldRetry: true, reason: "transient_error" };
  }
  return { shouldRetry: true, reason: "unknown_error" };
}
