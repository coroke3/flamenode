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
import { evaluateRestoreCapability } from "./capability";

// ============================================================
// writeAuditLog
// ============================================================

export type PreparedAuditLogEntry = {
  id: string;
  table_name: string;
  target_id: string;
  operation: AuditOperation;
  before_json: string | null;
  after_json: string | null;
  changed_keys_json: string | null;
  inverse_patch_json: string | null;
  actor_user_id: string;
  actor_snapshot_json: string | null;
  reason: string | null;
  context: string | null;
  retention_class: RetentionClass;
  restore_strategy: RestoreStrategy;
  restore_status: RestoreStatus;
  restore_unavailable_reason_code: string | null;
  restore_unavailable_message: string | null;
  payload_size_bytes: number;
  expires_at: number | null;
  created_at: number;
};

/**
 * 監査 INSERT 用の完全行スナップショットを準備する。
 *
 * 実際の INSERT はこの関数の呼び出し元が D1 batch に含められるよう分離している。
 * これにより本体 mutation と audit_logs INSERT を同じ all-or-nothing 単位にできる。
 */
export async function prepareAuditLogEntry(
  db: DB,
  input: WriteAuditLogInput,
): Promise<PreparedAuditLogEntry | null> {
  if (BLOCKED_TABLES.has(input.table_name)) return null;

  const operation: AuditOperation = input.operation;

  const retentionClass: RetentionClass = input.retention_class ?? "normal";
  const restoreStrategy: RestoreStrategy =
    input.restore_strategy ?? RestoreStrategy.none;

  let settings;
  try {
    settings = await getAuditLogSettings(db);
  } catch (error) {
    if (input.strict) throw error;
    const { DEFAULT_AUDIT_LOG_SETTINGS } = await import("./retention");
    settings = DEFAULT_AUDIT_LOG_SETTINGS;
  }

  // アクタースナップショット
  let actorJson: string | null = null;
  try {
    const actor = await buildActorSnapshot(db, input.actor_user_id);
    actorJson = JSON.stringify(actor);
  } catch {
    actorJson = JSON.stringify({ discord_id: null, discord_name: null, x_user_id: null, x_name: null, icon_url: null });
  }

  // 復元用スナップショットでは任意切り詰めを行わない。上限超過は
  // payload_size_bytes と restore capability で明示的に not_restorable にする。
  const sanitizedBefore = sanitizeForAudit(
    input.before ?? null,
    Number.MAX_SAFE_INTEGER,
  );
  const sanitizedAfter = sanitizeForAudit(
    input.after ?? null,
    Number.MAX_SAFE_INTEGER,
  );

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

  // ペイロード超過時は before/after を null に
  const finalBeforeJson = payloadExceeded ? null : beforeJson;
  const finalAfterJson = payloadExceeded ? null : afterJson;

  const capability = evaluateRestoreCapability({
    tableName: input.table_name,
    strategy: restoreStrategy,
    before: payloadExceeded ? null : sanitizedBefore,
    after: payloadExceeded ? null : sanitizedAfter,
    payloadExceeded,
  });

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = computeExpiresAt(now, retentionClass, settings);
  const id = generateId("audit");

  return {
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
    restore_status: capability.status,
    restore_unavailable_reason_code: capability.restorable
      ? null
      : capability.reasonCode,
    restore_unavailable_message: capability.restorable
      ? null
      : capability.message,
    payload_size_bytes: payloadSize,
    expires_at: expiresAt,
    created_at: now,
  };
}

/**
 * 単独の監査記録用。重要 mutation は `mutateWithAudit` を通して D1 batch に含める。
 */
export async function writeAuditLog(
  db: DB,
  input: WriteAuditLogInput,
): Promise<string | null> {
  try {
    const entry = await prepareAuditLogEntry(db, input);
    if (!entry) return null;
    await db.insert(auditLogs).values(entry);
    return entry.id;
  } catch (err) {
    if (input.strict) throw err;
    return null;
  }
}
