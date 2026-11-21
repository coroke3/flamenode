import { z } from "zod";

/**
 * MIG-0662 SA-011: CURRENT src/lib/actions/audit-admin.ts restoreSchema.
 * Keep the FormData field names and coerce semantics for Hono JSON requests.
 */
export const AuditRestoreSchema = z.object({
  audit_id: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(500),
  confirm_text: z.string().trim().optional(),
  // A conflict override is a destructive, explicitly confirmed operation.
  // CURRENT's FormData checkbox supplies literal "0"/"1"; Hono JSON also
  // accepts numeric 0/1. Generic numeric coercion would additionally turn
  // "01", "+1", "1e0", "0x1", " 1 " etc. into a destructive 1 despite
  // none being the explicit UI flag. Reject such noncanonical spellings,
  // along with JSON booleans/null/arrays/objects, rather than silently force.
  force_overwrite: z.union([
    z.literal("0"), z.literal("1"), z.literal(0), z.literal(1),
  ]).transform(Number).default(0),
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
