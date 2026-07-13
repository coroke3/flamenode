import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { auditLogSettings } from "@/lib/db/schema";
import type { AuditLogSettings } from "./types";
import { DEFAULT_AUDIT_LOG_SETTINGS } from "./retention";
import { mutateWithAudit } from "./mutate";
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

  // 読み取り経路で設定行を作ると、監査なしの runtime mutation になる。
  // 行がない間は既定値を返し、初回の明示的な設定更新を監査付きで作成する。
  if (!row) return { ...DEFAULT_AUDIT_LOG_SETTINGS };

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

  const before = existing
    ? await db.select().from(auditLogSettings).where(eq(auditLogSettings.id, SETTINGS_ID)).get()
    : null;
  const base = before ?? {
    normal_retention_days: DEFAULT_AUDIT_LOG_SETTINGS.normal_retention_days,
    restorable_retention_days: DEFAULT_AUDIT_LOG_SETTINGS.restorable_retention_days,
    long_audit_retention_days: DEFAULT_AUDIT_LOG_SETTINGS.long_audit_retention_days,
    max_payload_bytes: DEFAULT_AUDIT_LOG_SETTINGS.max_payload_bytes,
    compact_after_days: DEFAULT_AUDIT_LOG_SETTINGS.compact_after_days,
  };
  const after = {
    id: SETTINGS_ID,
    normal_retention_days: patch.normal_retention_days ?? base.normal_retention_days,
    restorable_retention_days:
      patch.restorable_retention_days ?? base.restorable_retention_days,
    long_audit_retention_days:
      patch.long_audit_retention_days ?? base.long_audit_retention_days,
    max_payload_bytes: patch.max_payload_bytes ?? base.max_payload_bytes,
    compact_after_days: patch.compact_after_days ?? base.compact_after_days,
    updated_by_user_id: userId,
    updated_at: now,
  };
  const mutation = before
    ? db.update(auditLogSettings).set(after).where(eq(auditLogSettings.id, SETTINGS_ID))
    : db.insert(auditLogSettings).values(after);

  await mutateWithAudit(db, {
    mutationStatements: [mutation],
    expectedMutationChanges: 1,
    audits: [{
      table_name: "audit_log_settings",
      target_id: SETTINGS_ID,
      operation: AuditOperation.SYSTEM,
      before,
      after,
      actor_user_id: userId,
      reason: "監査ログ設定を更新",
      retention_class: "long_audit",
      restore_strategy: "none",
      strict: true,
      context: "audit_settings_update",
    }],
  });
}
