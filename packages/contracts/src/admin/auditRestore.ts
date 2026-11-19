import { z } from "zod";

/**
 * MIG-0662 SA-011: CURRENT src/lib/actions/audit-admin.ts restoreSchema.
 * Keep the FormData field names and coerce semantics for Hono JSON requests.
 */
export const AuditRestoreSchema = z.object({
  audit_id: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(500),
  confirm_text: z.string().trim().optional(),
  force_overwrite: z.coerce.number().int().min(0).max(1).default(0),
});

export type AuditRestoreRequest = z.infer<typeof AuditRestoreSchema>;

export interface AuditRestoreResponse {
  ok: boolean;
  message?: string;
  restore_run_id?: string;
  diff?: {
    current: Record<string, unknown> | null;
    target: Record<string, unknown> | null;
    conflicts: string[];
  };
}
