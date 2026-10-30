import { z } from "zod";

/** MIG-0661: shared public and admin CostGuardBanner read DTO.
 * Accepted writes are limited to 500 characters (with small audit prefixes).
 * Bound legacy/corrupt external mirror rows before API serialization to stay
 * well under the ZERO_1102 S2 64 KiB response size budget.
 */
export const MAX_COST_GUARD_BANNER_REASON_CHARS = 2048;

export function boundedCostGuardBannerReason(value: unknown): string | null {
  return typeof value === "string" &&
    value.length <= MAX_COST_GUARD_BANNER_REASON_CHARS
    ? value
    : null;
}

export const CostGuardBannerResponseSchema = z.object({
  mode: z.enum(["normal", "economy", "read_only", "static_only", "maintenance"]),
  reason: z.string().max(MAX_COST_GUARD_BANNER_REASON_CHARS).nullable(),
});

export type CostGuardBannerResponse = z.infer<typeof CostGuardBannerResponseSchema>;
