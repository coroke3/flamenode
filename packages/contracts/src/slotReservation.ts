import { z } from "zod";
import { MAX_SLOTS_PER_VIDEO } from "@flamenode/domain/slots/limits";

/**
 * MIG-0657 U01: HTTP bodies for SA-065..068.
 * CURRENT: src/lib/actions/slot.ts reserveSchema / extendSchema / mergeSchema.
 * The eventId and slotId are URL parameters, never trusted from a JSON body.
 * Parsing these inputs does not authorize a reservation or replace its D1 CAS guard.
 */
const operatorOverride = z.union([z.string(), z.boolean()]).optional();

/** POST /api/events/:eventId/slots/:slotId/reserve (SA-065). */
export const SlotReserveBodySchema = z.object({
  display_name: z.string().trim().min(1).max(80),
  // FormData supplies strings in CURRENT; JSON additionally allows finite numbers.
  // Exclude booleans, which z.coerce.number would accidentally convert to 0/1.
  consecutive_count: z.union([z.string(), z.number()])
    .pipe(z.coerce.number().int().min(1).max(MAX_SLOTS_PER_VIDEO))
    .default(1),
  operator_override: operatorOverride,
});
export type SlotReserveBody = z.infer<typeof SlotReserveBodySchema>;

/** POST /api/events/:eventId/slots/:slotId/extend (SA-067). */
export const SlotExtendBodySchema = z.object({
  direction: z.enum(["forward", "backward"]),
  operator_override: operatorOverride,
});
export type SlotExtendBody = z.infer<typeof SlotExtendBodySchema>;

/** POST /api/events/:eventId/slot-groups/merge (SA-068). */
export const SlotMergeBodySchema = z.object({
  gap_slot_id: z.string().trim().min(1),
  display_name: z.string().trim().min(1).max(80),
  operator_override: operatorOverride,
});
export type SlotMergeBody = z.infer<typeof SlotMergeBodySchema>;

/** SA-066 release has only the :slotId URL parameter; no mutation body. */
export const SlotReleaseBodySchema = z.object({}).strict();

/** CURRENT formFlag(formData, "operator_override") exact true-value set. */
export function isSlotOperatorOverrideRequested(value: string | boolean | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on";
}

/** SlotReserveResult + PendingPublicReflection, without exposing DB rows. */
export const SlotMutationResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    slotId: z.string(),
    slotCount: z.number().int().positive(),
    groupSize: z.number().int().positive(),
    pendingPublicReflection: z.boolean().optional(),
  }),
  z.object({
    ok: z.literal(false),
    message: z.string().optional(),
    reason: z.string().optional(),
  }),
]);
export type SlotMutationResult = z.infer<typeof SlotMutationResultSchema>;
