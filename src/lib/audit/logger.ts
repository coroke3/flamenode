import type { DB } from "@/lib/db/client";
import { auditLogs } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";
import type {
  AuditOperation,
  RetentionClass,
  RestoreStatus,
  WriteAuditLogInput,
} from "./types";
import { RestoreStrategy } from "./types";
import {
  sanitizeForAudit,
  computeChangedKeys,
  buildInversePatch,
  calculatePayloadSize,
  BLOCKED_TABLES,
} from "./snapshot";
import { computeExpiresAt } from "./retention";
import { getAuditLogSettings } from "./settings";
import { buildActorSnapshot } from "./actor";

// ============================================================
// レガシー action 名マッピング
// ============================================================

const LEGACY_ACTION_MAP: Record<string, AuditOperation> = {
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
};

// ============================================================
// writeAuditLog
// ============================================================

/**
 * 監査ログを audit_logs テーブルに書き込む。
 *
 * - ブロック対象テーブルは即座に return
 * - 設定を読み込み (なければデフォルトを作成)
 * - アクタースナップショットを構築
 * - before/after をサニタイズ
 * - 変更キー・逆パッチを計算
 * - ペイロードサイズをチェック
 * - restore_status を決定
 * - audit_logs に INSERT
 */
export async function writeAuditLog(
  db: DB,
  input: WriteAuditLogInput,
): Promise<string | null> {
  // ブロック対象テーブルはスキップ
  if (BLOCKED_TABLES.has(input.table_name)) return null;

  // レガシー action 名を operation にマップ (互換)
  const operation: AuditOperation =
    LEGACY_ACTION_MAP[input.operation] ?? input.operation;

  const retentionClass: RetentionClass = input.retention_class ?? "normal";
  const restoreStrategy: RestoreStrategy =
    input.restore_strategy ?? RestoreStrategy.none;

  let settings;
  try {
    settings = await getAuditLogSettings(db);
  } catch {
    // 設定取得失敗時はデフォルトを使用
    const { DEFAULT_AUDIT_LOG_SETTINGS } = await import("./retention");
    settings = DEFAULT_AUDIT_LOG_SETTINGS;
  }

  // アクタースナップショット
  let actorJson: string | null = null;
  try {
    const actor = await buildActorSnapshot(db, input.actor_user_id);
    actorJson = JSON.stringify(actor);
  } catch {
    actorJson = JSON.stringify({ discord_user_id: null, discord_name: null, x_user_id: null, x_name: null, icon_url: null });
  }

  // サニタイズ
  const sanitizedBefore = sanitizeForAudit(input.before ?? null);
  const sanitizedAfter = sanitizeForAudit(input.after ?? null);

  const beforeJson = sanitizedBefore ? JSON.stringify(sanitizedBefore) : null;
  const afterJson = sanitizedAfter ? JSON.stringify(sanitizedAfter) : null;

  // 変更キー・逆パッチ
  const changedKeys = computeChangedKeys(sanitizedBefore, sanitizedAfter);
  const inversePatch = buildInversePatch(sanitizedBefore, sanitizedAfter);

  const changedKeysJson = changedKeys.length > 0 ? JSON.stringify(changedKeys) : null;
  const inversePatchJson = inversePatch ? JSON.stringify(inversePatch) : null;

  // ペイロードサイズチェック
  const payloadSize = calculatePayloadSize(beforeJson, afterJson);
  const payloadExceeded = payloadSize > settings.max_payload_bytes;

  // restore_status の決定
  let restoreStatus: RestoreStatus;
  if (payloadExceeded) {
    restoreStatus = "not_restorable";
  } else if (restoreStrategy !== RestoreStrategy.none) {
    restoreStatus = "restorable";
  } else {
    restoreStatus = "not_restorable";
  }

  // ペイロード超過時は before/after を null に
  const finalBeforeJson = payloadExceeded ? null : beforeJson;
  const finalAfterJson = payloadExceeded ? null : afterJson;

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = computeExpiresAt(now, retentionClass, settings);
  const id = generateId("audit");

  try {
    await db.insert(auditLogs).values({
      id,
      table_name: input.table_name,
      target_id: input.target_id,
      operation,
      before_json: finalBeforeJson,
      after_json: finalAfterJson,
      changed_keys_json: changedKeysJson,
      inverse_patch_json: inversePatchJson,
      actor_user_id: input.actor_user_id,
      actor_snapshot_json: actorJson,
      reason: input.reason ?? null,
      context: input.context ?? null,
      retention_class: retentionClass,
      restore_strategy: restoreStrategy,
      restore_status: restoreStatus,
      payload_size_bytes: payloadSize,
      expires_at: expiresAt,
      created_at: now,
    });

    return id;
  } catch (err) {
    if (input.strict) throw err;
    return null;
  }
}
