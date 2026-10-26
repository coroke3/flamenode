import { z } from "zod";

/** MIG-0661: shared public and admin CostGuardBanner read DTO. */
export const CostGuardBannerResponseSchema = z.object({
  mode: z.enum(["normal", "economy", "read_only", "static_only", "maintenance"]),
  reason: z.string().nullable(),
});

export type CostGuardBannerResponse = z.infer<typeof CostGuardBannerResponseSchema>;
