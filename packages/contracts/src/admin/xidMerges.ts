import { z } from "zod";

/**
 * MIG-0644 U01: JSON transport shapes for SA-092..097.
 * CURRENT reads FormData with String(value ?? "") before domain validation.
 * Permit scalar JSON values (and missing/null fields) so the Hono adapters
 * can preserve CURRENT's explicit validation messages and ordering.
 * IDs for approval, rejection, execution and revert are URL path params,
 * not part of the D-17-4 JSON request body.
 */
const legacyFormScalar = z.union([z.string(), z.number(), z.boolean()]).nullish();

/** SA-092: POST /api/admin/x-id-merges. */
export const AdminXIdMergeCreateBodySchema = z.object({
  from_x_user_id: legacyFormScalar,
  to_x_user_id: legacyFormScalar,
});

/** SA-093/094/095: id comes from the corresponding URL path. */
export const AdminXIdMergeDecisionBodySchema = z.object({});

/** SA-096/097: domain checks MERGE or REVERT after the admin gate. */
export const AdminXIdMergeConfirmBodySchema = z.object({
  confirm: legacyFormScalar,
});

/** All six CURRENT Server Actions return this shape. */
export const AdminXIdMergeResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  id: z.string().optional(),
});

export type AdminXIdMergeCreateBody = z.infer<typeof AdminXIdMergeCreateBodySchema>;
export type AdminXIdMergeDecisionBody = z.infer<typeof AdminXIdMergeDecisionBodySchema>;
export type AdminXIdMergeConfirmBody = z.infer<typeof AdminXIdMergeConfirmBodySchema>;
export type AdminXIdMergeResult = z.infer<typeof AdminXIdMergeResultSchema>;
