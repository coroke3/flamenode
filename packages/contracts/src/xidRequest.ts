import { z } from "zod";

/**
 * MIG-0659 (SA-099..101, D-16-1): HTTP contract of the X ID request APIs, consumed by MIG-0709.
 * Body keys are CURRENT's FormData keys; the request id of cancel is the path value (not in the body).
 * Response is CURRENT's XIdActionResult as JSON with 200 / 400 / 401 / 403 / 404 / 409 / 413 / 503.
 */

/** POST /api/xid/requests (SA-099 requestXIdLink). `request_type` wins over `link_type`; both default to "link". */
export const XIdRequestBodySchema = z.object({
  x_id: z.string().max(2048).default(""),
  request_type: z.string().max(32).optional(),
  link_type: z.string().max(32).optional(),
  target_x_user_id: z.string().max(2048).default(""),
});
export type XIdRequestBody = z.input<typeof XIdRequestBodySchema>;

/** POST /api/xid/merge-revert-requests (SA-101 requestXIdMergeRevert). */
export const XIdMergeRevertBodySchema = z.object({
  parent_request_id: z.string().max(256).default(""),
});
export type XIdMergeRevertBody = z.input<typeof XIdMergeRevertBodySchema>;

/** POST /api/xid/requests/:id/cancel (SA-100 cancelXIdLinkRequest) takes no body. */
export const XIdRequestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
});
export type XIdRequestResult = z.infer<typeof XIdRequestResultSchema>;
