import { z } from "zod";

/** MIG-0602 SA-007: POST /api/admin/api-endpoints body. */
export const ApiEndpointCreateBodySchema = z.object({
  event_id: z.string().optional(),
});
export type ApiEndpointCreateBody = z.infer<typeof ApiEndpointCreateBodySchema>;

/**
 * MIG-0602 SA-008: PATCH /api/admin/api-endpoints/:id body.
 * CURRENT: String(public_api_enabled ?? "0") === "1" ? 1 : 0. The Hono API
 * additionally accepts JSON booleans / numbers; true / 1 / "1" enable,
 * false / 0 / "0" / absent disable. Any other type is rejected.
 */
export const ApiEndpointEnabledSchema = z
  .union([z.boolean(), z.literal(0), z.literal(1), z.literal("0"), z.literal("1")])
  .nullish()
  .transform((value): 0 | 1 => (value === true || value === 1 || value === "1" ? 1 : 0));

export const ApiEndpointSetActiveBodySchema = z.object({
  public_api_enabled: ApiEndpointEnabledSchema,
});
export type ApiEndpointSetActiveBody = z.infer<typeof ApiEndpointSetActiveBodySchema>;

export const ApiEndpointResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  id: z.string().optional(),
});
