import type { DB } from "@/lib/db/client";
import type { BatchItem } from "drizzle-orm/batch";

// ============================================================
// 監査ログ操作種別
// ============================================================

export const AuditOperation = {
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  RESTORE: "RESTORE",
  STATUS_CHANGE: "STATUS_CHANGE",
  MERGE: "MERGE",
  SYSTEM: "SYSTEM",
} as const;
export type AuditOperation = (typeof AuditOperation)[keyof typeof AuditOperation];

// ============================================================
// リストア状態
// ============================================================

export const RestoreStatus = {
  not_restorable: "not_restorable",
  restorable: "restorable",
  restored: "restored",
  expired: "expired",
  blocked: "blocked",
  failed: "failed",
} as const;
export type RestoreStatus = (typeof RestoreStatus)[keyof typeof RestoreStatus];

// ============================================================
// リストア戦略
// ============================================================

export const RestoreStrategy = {
  none: "none",
  update_before: "update_before",
  delete_created: "delete_created",
  recreate_deleted: "recreate_deleted",
  custom_adapter: "custom_adapter",
} as const;
export type RestoreStrategy = (typeof RestoreStrategy)[keyof typeof RestoreStrategy];

// ============================================================
// 保持クラス
// ============================================================

export const RetentionClass = {
  normal: "normal",
  restorable: "restorable",
  long_audit: "long_audit",
} as const;
export type RetentionClass = (typeof RetentionClass)[keyof typeof RetentionClass];

// ============================================================
// 監査ログ書き込み入力
// ============================================================

export interface WriteAuditLogInput {
  /** 対象テーブル名 */
  table_name: string;
  /** 対象レコードID */
  target_id: string;
  /** 操作種別 */
  operation: AuditOperation;
  /** 操作前データ (UPDATE/DELETE 時) */
  before?: Record<string, unknown> | null;
  /** 操作後データ (CREATE/UPDATE 時) */
  after?: Record<string, unknown> | null;
  /** 操作者ユーザーID (users テーブルの id) */
  actor_user_id: string;
  /** 変更理由などの任意メモ */
  reason?: string | null;
  /** 保持クラス */
  retention_class?: RetentionClass;
  /** リストア戦略 */
  restore_strategy?: RestoreStrategy;
  /** 失敗時に例外を投げるか (デフォルト false) */
  strict?: boolean;
  /** 操作コンテキスト (例: "admin_panel", "api", "worker") */
  context?: string | null;
}

// ============================================================
// 監査ログ設定
// ============================================================

export interface AuditLogSettings {
  /** 通常ログの保持日数 (default: 30) */
  normal_retention_days: number;
  /** リストア可能ログの保持日数 (default: 180) */
  restorable_retention_days: number;
  /** 長期監査ログの保持日数 (default: 365) */
  long_audit_retention_days: number;
  /** ペイロード最大バイト数。超過時はリストア不可にする (default: 20000) */
  max_payload_bytes: number;
  /** compact_after 日後に before/after を圧縮済みとしてマーク (default: 30) */
  compact_after_days: number;
}

// ============================================================
// アクタースナップショット
// ============================================================

export interface ActorSnapshot {
  discord_id: string | null;
  discord_name: string | null;
  x_user_id: string | null;
  x_name: string | null;
  icon_url: string | null;
}

// ============================================================
// リストア実行オプション
// ============================================================

export interface RestoreOptions {
  auditId: string;
  userId: string;
  reason: string;
  /** 確認テキスト (UI での意図的操作確認) */
  confirmText?: string;
  /** 現行レコードと競合しても上書きするか */
  forceOverwrite?: boolean;
  /** true の場合は実際に書き込まず dry run 結果だけ返す */
  dry_run?: boolean;
}

export interface RestoreResult {
  ok: boolean;
  message?: string;
  /** dry_run モード時の差分情報 */
  diff?: {
    current: Record<string, unknown> | null;
    target: Record<string, unknown> | null;
    conflicts: string[];
  };
  restore_run_id?: string;
  reason_code?: RestoreFailureReason | string;
  restore_status?: RestoreStatus;
}

export const RestoreFailureReason = {
  payloadExceeded: "payload_exceeded",
  strategyNone: "strategy_none",
  strategyUnsupported: "strategy_unsupported",
  adapterMissing: "adapter_missing",
  beforeMissing: "before_missing",
  afterMissing: "after_missing",
  snapshotInvalid: "snapshot_invalid",
  snapshotRedacted: "snapshot_redacted",
  primaryKeyMissing: "primary_key_missing",
  requiredFieldMissing: "required_field_missing",
  expired: "expired",
  alreadyRestored: "already_restored",
  targetConflict: "target_conflict",
  targetMissing: "target_missing",
  targetAlreadyExists: "target_already_exists",
  mutationFailed: "mutation_failed",
  ownerInvariant: "owner_invariant",
  uniqueConflict: "unique_conflict",
} as const;

export type RestoreFailureReason =
  (typeof RestoreFailureReason)[keyof typeof RestoreFailureReason];

// ============================================================
// リストアアダプター
// ============================================================

export interface RestoreAdapter {
  /** このアダプターが安全に実装している復元戦略。 */
  supportedStrategies: readonly RestoreStrategy[];
  fetchCurrent(
    db: DB,
    targetId: string,
  ): Promise<Record<string, unknown> | null>;
  /**
   * D1 batch に直接渡せる復元 mutation を返す。
   * `applyRestore` のように個別クエリを実行してはいけない。呼び出し元が
   * audit_logs / audit_restore_runs / RESTORE 監査ログと一つの batch にする。
   */
  buildRestoreMutation(
    db: DB,
    snapshot: Record<string, unknown>,
    strategy: RestoreStrategy,
    options: {
      forceOverwrite?: boolean;
      actorUserId: string;
      /** 復元前の再検証に使う、読み出し時点の現行行。 */
      expectedCurrent?: Record<string, unknown> | null;
    },
  ): {
    query: BatchItem<"sqlite">;
    expectedChanges: number;
  };
}
