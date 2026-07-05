import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { auditLogSettings } from "@/lib/db/schema";
import type { AuditLogSettings } from "./types";
import { DEFAULT_AUDIT_LOG_SETTINGS } from "./retention";
import { writeAuditLog } from "./logger";
import { AuditOperation } from "./types";

const SETTINGS_ID = "default";

/**
 * audit_log_settings テーブルから設定を取得する。
 * レコードが存在しない場合はデフォルト値で作成してから返す。
 */
export async function getAuditLogSettings(db: DB): Promise<AuditLogSettings> {
  const row = await db
    .select()
    .from(auditLogSettings)
    .where(eq(auditLogSettings.id, SETTINGS_ID))
    .get();

  if (!row) {
    await db.insert(auditLogSettings).values({
      id: SETTINGS_ID,
      normal_retention_days: DEFAULT_AUDIT_LOG_SETTINGS.normal_retention_days,
      restorable_retention_days:
        DEFAULT_AUDIT_LOG_SETTINGS.restorable_retention_days,
      long_audit_retention_days:
        DEFAULT_AUDIT_LOG_SETTINGS.long_audit_retention_days,
      max_payload_bytes: DEFAULT_AUDIT_LOG_SETTINGS.max_payload_bytes,
      compact_after_days: DEFAULT_AUDIT_LOG_SETTINGS.compact_after_days,
      updated_by_user_id: null,
      updated_at: Math.floor(Date.now() / 1000),
    }).onConflictDoNothing();

    return { ...DEFAULT_AUDIT_LOG_SETTINGS };
  }

  return {
    normal_retention_days: row.normal_retention_days,
    restorable_retention_days: row.restorable_retention_days,
    long_audit_retention_days: row.long_audit_retention_days,
    max_payload_bytes: row.max_payload_bytes,
    compact_after_days: row.compact_after_days,
  };
}

/**
 * 監査ログ設定を部分更新する。
 */
export async function updateAuditLogSettings(
  db: DB,
  userId: string,
  patch: Partial<AuditLogSettings>,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  // 既存レコードを確認して upsert する
  const existing = await db
    .select({ id: auditLogSettings.id })
    .from(auditLogSettings)
    .where(eq(auditLogSettings.id, SETTINGS_ID))
    .get();

  if (!existing) {
    const defaults = DEFAULT_AUDIT_LOG_SETTINGS;
    await db.insert(auditLogSettings).values({
      id: SETTINGS_ID,
      normal_retention_days: patch.normal_retention_days ?? defaults.normal_retention_days,
      restorable_retention_days:
        patch.restorable_retention_days ?? defaults.restorable_retention_days,
      long_audit_retention_days:
        patch.long_audit_retention_days ?? defaults.long_audit_retention_days,
      max_payload_bytes: patch.max_payload_bytes ?? defaults.max_payload_bytes,
      compact_after_days: patch.compact_after_days ?? defaults.compact_after_days,
      updated_by_user_id: userId,
      updated_at: now,
    });
    return;
  }

  const beforeSettings = await getAuditLogSettings(db);

  const updates: Record<string, unknown> = { updated_by_user_id: userId, updated_at: now };
  if (patch.normal_retention_days !== undefined)
    updates.normal_retention_days = patch.normal_retention_days;
  if (patch.restorable_retention_days !== undefined)
    updates.restorable_retention_days = patch.restorable_retention_days;
  if (patch.long_audit_retention_days !== undefined)
    updates.long_audit_retention_days = patch.long_audit_retention_days;
  if (patch.max_payload_bytes !== undefined)
    updates.max_payload_bytes = patch.max_payload_bytes;
  if (patch.compact_after_days !== undefined)
    updates.compact_after_days = patch.compact_after_days;

  await db
    .update(auditLogSettings)
    .set(updates)
    .where(eq(auditLogSettings.id, SETTINGS_ID));

  const after = await getAuditLogSettings(db);
  await writeAuditLog(db, {
    table_name: "audit_log_settings",
    target_id: SETTINGS_ID,
    operation: AuditOperation.SYSTEM,
    before: { ...beforeSettings },
    after: { ...after },
    actor_user_id: userId,
    reason: "監査ログ設定を更新",
    retention_class: "long_audit",
    strict: true,
    context: "audit_settings_update",
  }).catch(() => undefined);
}
