import { z } from "zod";

/**
 * SA-009: audit log settings patch schema.
 * Matches CURRENT src/lib/actions/audit-admin.ts settingsPatchSchema.
 */
export const AuditSettingsPatchSchema = z.object({
  normal_retention_days: z.coerce.number().int().min(7).max(365).optional(),
  restorable_retention_days: z.coerce.number().int().min(14).max(1095).optional(),
  long_audit_retention_days: z.coerce.number().int().min(30).max(3650).optional(),
  max_payload_bytes: z.coerce.number().int().min(1000).max(1000000).optional(),
  compact_after_days: z.coerce.number().int().min(1).max(365).optional(),
});

export type AuditSettingsPatch = z.infer<typeof AuditSettingsPatchSchema>;

/**
 * SA-010: audit restore dry run input schema.
 * Matches CURRENT src/lib/actions/audit-admin.ts dryRunSchema.
 */
export const AuditDryRunSchema = z.object({
  audit_id: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(500),
});

export type AuditDryRun = z.infer<typeof AuditDryRunSchema>;

export interface UpdateAuditLogSettingsResult {
  ok: boolean;
  message?: string;
}

export interface AuditDiff {
  current: Record<string, unknown> | null;
  target: Record<string, unknown> | null;
  conflicts: string[];
}

export interface AuditLogDryRunResult {
  ok: boolean;
  message?: string;
  diff?: AuditDiff;
}
