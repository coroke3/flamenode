import type { AuditLogSettings, RetentionClass } from "./types";

// ============================================================
// デフォルト設定
// ============================================================

export const DEFAULT_AUDIT_LOG_SETTINGS: AuditLogSettings = {
  normal_retention_days: 30,
  restorable_retention_days: 180,
  long_audit_retention_days: 365,
  max_payload_bytes: 120_000,
  compact_after_days: 30,
};// ============================================================
// 保持日数の範囲制約
// ============================================================

const RETENTION_RANGES: Record<
  RetentionClass,
  { min: number; max: number }
> = {
  normal: { min: 7, max: 365 },
  restorable: { min: 14, max: 1095 },
  long_audit: { min: 30, max: 3650 },
};

/**
 * 保持クラスに応じて日数を有効範囲内にクランプして返す。
 */
export function clampRetentionDays(
  retentionClass: RetentionClass,
  days: number,
): number {
  const range = RETENTION_RANGES[retentionClass];
  return Math.max(range.min, Math.min(range.max, Math.round(days)));
}

// ============================================================
// getRetentionDaysForClass
// ============================================================

/**
 * 設定から保持クラスに対応する日数を取得して返す。
 */
export function getRetentionDaysForClass(
  settings: AuditLogSettings,
  retentionClass: RetentionClass,
): number {
  switch (retentionClass) {
    case "normal":
      return settings.normal_retention_days;
    case "restorable":
      return settings.restorable_retention_days;
    case "long_audit":
      return settings.long_audit_retention_days;
  }
}

// ============================================================
// computeExpiresAt
// ============================================================

/**
 * 作成日時 (Unix 秒) と保持クラス・設定から expires_at (Unix 秒) を計算する。
 */
export function computeExpiresAt(
  createdAt: number,
  retentionClass: RetentionClass,
  settings: AuditLogSettings,
): number {
  const rawDays = getRetentionDaysForClass(settings, retentionClass);
  const days = clampRetentionDays(retentionClass, rawDays);
  return createdAt + days * 86400;
}
