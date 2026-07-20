import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { systemSettings } from "@/lib/db/schema";
import type { AuditLogSettings } from "./types";
import { DEFAULT_AUDIT_LOG_SETTINGS } from "./retention";
import { mutateWithAudit } from "./mutate";
import { AuditOperation } from "./types";

const SETTINGS_ID = "default";

function mapAuditSettings(
  row: typeof systemSettings.$inferSelect | null | undefined,
): AuditLogSettings {
  if (!row) return { ...DEFAULT_AUDIT_LOG_SETTINGS };
  return {
    normal_retention_days: row.audit_normal_retention_days,
    restorable_retention_days: row.audit_restorable_retention_days,
    long_audit_retention_days: row.audit_long_retention_days,
    max_payload_bytes: row.audit_max_payload_bytes,
    compact_after_days: row.audit_compact_after_days,
  };
}

/** system_settings.audit_* だけを監査設定の正本として読む。 */
export async function getAuditLogSettings(db: DB): Promise<AuditLogSettings> {
  const row = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.id, SETTINGS_ID))
    .get();
  return mapAuditSettings(row);
}

/** system_settings.audit_* を監査付きで部分更新する。 */
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
  const base = mapAuditSettings(before);
  const settingsAfter: AuditLogSettings = {
    normal_retention_days:
      patch.normal_retention_days ?? base.normal_retention_days,
    restorable_retention_days:
      patch.restorable_retention_days ?? base.restorable_retention_days,
    long_audit_retention_days:
      patch.long_audit_retention_days ?? base.long_audit_retention_days,
    max_payload_bytes: patch.max_payload_bytes ?? base.max_payload_bytes,
    compact_after_days: patch.compact_after_days ?? base.compact_after_days,
  };
  const values = {
    audit_normal_retention_days: settingsAfter.normal_retention_days,
    audit_restorable_retention_days: settingsAfter.restorable_retention_days,
    audit_long_retention_days: settingsAfter.long_audit_retention_days,
    audit_max_payload_bytes: settingsAfter.max_payload_bytes,
    audit_compact_after_days: settingsAfter.compact_after_days,
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
