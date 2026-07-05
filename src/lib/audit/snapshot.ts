/**
 * 監査ログ用 JSON サニタイズ・差分計算ユーティリティ。
 * Node.js 専用 API を使わない純粋関数のみ。
 */

// ============================================================
// 定数
// ============================================================

/** ログに記録しないテーブル (認証・セッション系) */
export const BLOCKED_TABLES = new Set([
  "account",
  "session",
  "verificationToken",
]);

/** 値をリダクトするフィールド名 (完全一致) */
const REDACT_FIELDS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "sessionToken",
  "verification_token",
  "token",
  "secret",
  "password",
]);

const REDACTED_MARKER = "[REDACTED]";

/** フィールド値の文字列化後の最大長 (デフォルト) */
export const DEFAULT_MAX_FIELD_LENGTH = 2000;

// ============================================================
// sanitizeForAudit
// ============================================================

/**
 * 監査ログ用に JSON オブジェクトをサニタイズする。
 * - undefined キーを削除
 * - 機密フィールドをリダクト
 * - 大きな文字列を切り詰め
 */
export function sanitizeForAudit(
  obj: Record<string, unknown> | null | undefined,
  maxFieldLength = DEFAULT_MAX_FIELD_LENGTH,
): Record<string, unknown> | null {
  if (obj == null) return null;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;

    if (REDACT_FIELDS.has(key)) {
      result[key] = REDACTED_MARKER;
      continue;
    }

    if (typeof value === "string") {
      result[key] =
        value.length > maxFieldLength
          ? value.slice(0, maxFieldLength) + "…[truncated]"
          : value;
      continue;
    }

    if (value !== null && typeof value === "object") {
      // ネストされたオブジェクトも再帰的にサニタイズ
      result[key] = sanitizeForAudit(
        value as Record<string, unknown>,
        maxFieldLength,
      );
      continue;
    }

    result[key] = value;
  }

  return result;
}

// ============================================================
// computeChangedKeys
// ============================================================

/**
 * before と after を比較して変更されたキーの配列を返す。
 * どちらかが null の場合は全キーを返す。
 */
export function computeChangedKeys(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  if (before == null && after == null) return [];
  if (before == null) return Object.keys(after!);
  if (after == null) return Object.keys(before);

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const key of keys) {
    // JSON を介して比較 (undefined / 型違いも吸収)
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed.push(key);
    }
  }
  return changed;
}

// ============================================================
// buildInversePatch
// ============================================================

/**
 * update_before 戦略用の逆パッチ。
 * after → before へ戻すための差分オブジェクトを返す。
 * キーは after にあって値が異なるもの、または after にないが before にあるもの。
 */
export function buildInversePatch(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (before == null || after == null) return null;

  const patch: Record<string, unknown> = {};
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      // before の値で上書きすれば戻る
      patch[key] = before[key] ?? null;
    }
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

// ============================================================
// calculatePayloadSize
// ============================================================

/**
 * before_json / after_json の合計バイト数 (UTF-8 換算) を返す。
 * Cloudflare Workers でも動作する TextEncoder を使用。
 */
export function calculatePayloadSize(
  beforeJson: string | null,
  afterJson: string | null,
): number {
  const encoder = new TextEncoder();
  const bLen = beforeJson ? encoder.encode(beforeJson).length : 0;
  const aLen = afterJson ? encoder.encode(afterJson).length : 0;
  return bLen + aLen;
}
