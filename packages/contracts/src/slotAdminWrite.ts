import { z } from "zod";

/**
 * MIG-0656 (SA-056..064): JSON boundary for the future Hono manage slot writes.
 * The eventId/slotId is supplied by the route and must be checked against the
 * authorized event before touching D1. These schemas do NOT grant permission.
 *
 * CURRENT: src/lib/actions/slot-admin.ts and slot-admin-danger.ts (FormData).
 * Unlike FormData's z.coerce.number(), JSON counts are actual numbers; bool,
 * null and numeric strings must not silently become counts.
 * No route is mounted in this unit.
 */
const slotCount = z.number().int().min(1).max(100);
const slotInterval = z.number().int().min(1).max(1440);
const slotStartIndex = z.number().int().min(0).max(9999);
const slotLabelPrefix = z.string().trim().max(40).nullish();

/**
 * CURRENT has one batchSchema for both generation modes, so the fields of the
 * inactive mode are ALSO validated (e.g. time + count:101 must fail).
 * Keep that shared boundary even though the future Hono JSON transport uses
 * actual numbers instead of FormData's numeric strings.
 *
 * Output contains only the chosen mode's fields. Valid inactive fields may be
 * present on input for CURRENT parity but never flow to a write handler.
 * Unknown keys retain CURRENT z.object's stripping behavior.
 */
export const SlotGenerateBodySchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("time"),
    start_at: z.string().nullish(),
    end_at: z.string().nullish(),
    interval_minutes: slotInterval.default(5),
    count: slotCount.optional(),
    label_prefix: slotLabelPrefix,
    start_index: slotStartIndex.optional(),
  }),
  z.object({
    mode: z.literal("count"),
    start_at: z.string().nullish(),
    end_at: z.string().nullish(),
    interval_minutes: slotInterval.optional(),
    count: slotCount.default(1),
    label_prefix: slotLabelPrefix,
    start_index: slotStartIndex.default(1),
  }),
]).transform((parsed) => {
  if (parsed.mode === "time") {
    return {
      mode: parsed.mode,
      ...(parsed.start_at !== undefined ? { start_at: parsed.start_at } : {}),
      ...(parsed.end_at !== undefined ? { end_at: parsed.end_at } : {}),
      interval_minutes: parsed.interval_minutes,
    };
  }
  return {
    mode: parsed.mode,
    count: parsed.count,
    start_index: parsed.start_index,
    ...(parsed.label_prefix !== undefined ? { label_prefix: parsed.label_prefix } : {}),
  };
});
export type SlotGenerateBody = z.infer<typeof SlotGenerateBodySchema>;

/**
 * CURRENT parseSlotIds deduplicates trimmed ids *before* enforcing the atomic
 * maximum of 3 rows. Preserve that order for typed JSON array bodies.
 * Unsupported scalar IDs fail rather than being silently stringified.
 */
export const SlotBatchIdsBodySchema = z.object({
  slot_ids: z.array(z.string().trim().min(1))
    .transform((ids) => Array.from(new Set(ids)))
    .pipe(z.array(z.string()).min(1).max(3)),
});
export type SlotBatchIdsBody = z.infer<typeof SlotBatchIdsBodySchema>;

export const SlotBatchLabelsBodySchema = SlotBatchIdsBodySchema.and(
  z.object({ label: z.string().trim().min(1).max(200) }),
);
export type SlotBatchLabelsBody = z.infer<typeof SlotBatchLabelsBodySchema>;

/**
 * SA-059 deletes all available slots; SA-060/061 release/delete one slot;
 * SA-056/057 are dangerous submitted-slot operations. All use eventId/slotId
 * from the URL. CURRENT has no confirmation FormData field for SA-056/057;
 * authorization, CAS/version checks and audit must be implemented by Hono.
 */
export const SlotNoBodySchema = z.object({}).strict();

export const SlotAdminWriteBodySchemas = {
  generateSlotsBatch: SlotGenerateBodySchema,
  deleteAvailableSlots: SlotNoBodySchema,
  releaseSlot: SlotNoBodySchema,
  deleteSlot: SlotNoBodySchema,
  batchDeleteAvailableSlots: SlotBatchIdsBodySchema,
  batchReleaseReservedSlots: SlotBatchIdsBodySchema,
  batchUpdateSlotLabels: SlotBatchLabelsBodySchema,
  forceReleaseSubmittedSlot: SlotNoBodySchema,
  releaseSubmittedVideoKeepReservation: SlotNoBodySchema,
} as const;
