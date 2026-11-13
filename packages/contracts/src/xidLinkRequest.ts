import { z } from "zod";

/**
 * MIG-0605 U05x transport boundary for SA-090/091.
 * The request id belongs to the URL; CURRENT reads and trims request_id
 * from FormData. Approval has no additional input. A rejection reason is
 * trimmed before the CURRENT 500-character cap (xid-admin.ts).
 * These contracts do not authorize or execute either mutation.
 */
export const XIdLinkReviewRequestIdSchema = z.string().trim().min(1);
export const XIdLinkApproveBodySchema = z.object({}).strict();
export const XIdLinkRejectBodySchema = z
  .object({ reason: z.string().optional() })
  .strict()
  .transform(({ reason }) => ({ reason: (reason ?? "").trim().slice(0, 500) }));

// Keep the response contract closed: unknown fields must not silently pass
// through a migration boundary as if they were part of CURRENT parity.
export const XIdLinkReviewResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
}).strict();

export type XIdLinkReviewResult = z.infer<typeof XIdLinkReviewResultSchema>;
