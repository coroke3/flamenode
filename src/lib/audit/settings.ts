import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { systemSettings } from "@/lib/db/schema";
import type { AuditLogSettings } from "./types";
import { DEFAULT_AUDIT_LOG_SETTINGS } from "./retention";
import { mutateWithAudit } from "./mutate";
import { AuditOperation } from "./types";

const SETTINGS_ID = "default";

function toAuditLogSettings(
  row: typeof systemSettings.$inferSelect,
): AuditLogSettings {
  return {
    normal_retention_days: row.audit_normal_retention_days,
    restorable_retention_days: row.audit_restorable_retention_days,
    long_audit_retention_days: row.audit_long_retention_days,
    max_payload_bytes: row.audit_max_payload_bytes,
    compact_after_days: row.audit_compact_after_days,
  };
}

/** system_settings の監査設定列を唯一の正本として読み取る。 */
export async function getAuditLogSettings(db: DB): Promise<AuditLogSettings> {
  const row = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.id, SETTINGS_ID))
    .get();
  return row ? toAuditLogSettings(row) : { ...DEFAULT_AUDIT_LOG_SETTINGS };
}

/** system_settings の監査設定列を監査付きで更新する。 */
export async function updateAuditLogSettings(
  db: DB,
  userId: string,
  patch: Partial<AuditLogSettings>,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const before = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.id, SETTINGS_ID))
    .get();
  const current = before
    ? toAuditLogSettings(before)
    : { ...DEFAULT_AUDIT_LOG_SETTINGS };
  const next: AuditLogSettings = {
    normal_retention_days:
      patch.normal_retention_days ?? current.normal_retention_days,
    restorable_retention_days:
      patch.restorable_retention_days ?? current.restorable_retention_days,
    long_audit_retention_days:
      patch.long_audit_retention_days ?? current.long_audit_retention_days,
    max_payload_bytes: patch.max_payload_bytes ?? current.max_payload_bytes,
    compact_after_days:
      patch.compact_after_days ?? current.compact_after_days,
  };
  const values = {
    audit_normal_retention_days: next.normal_retention_days,
    audit_restorable_retention_days: next.restorable_retention_days,
    audit_long_retention_days: next.long_audit_retention_days,
    audit_max_payload_bytes: next.max_payload_bytes,
    audit_compact_after_days: next.compact_after_days,
    audit_updated_by_auth_user_id: userId,
    audit_updated_at: now,
  };
  const after = before
    ? { ...before, ...values }
    : { id: SETTINGS_ID, ...values };
  const mutation = before
    ? db
        .update(systemSettings)
        .set(values)
        .where(eq(systemSettings.id, SETTINGS_ID))
    : db.insert(systemSettings).values(after);

  await mutateWithAudit(db, {
    mutationStatements: [mutation],
    expectedMutationChanges: 1,
    audits: [
      {
        table_name: "system_settings",
        target_id: SETTINGS_ID,
        operation: AuditOperation.SYSTEM,
        before: before ? { ...before } : null,
        after: { ...after },
        actor_user_id: userId,
        reason: "監査ログ設定を更新",
        retention_class: "long_audit",
        restore_strategy: "none",
        strict: true,
        context: "audit_settings_update",
      },
    ],
  });
}
