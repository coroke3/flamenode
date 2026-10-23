import { z } from "zod";

export const AboutStatsDataSchema = z.object({
  publicVideos: z.number(),
  creators: z.number(),
  events: z.number(),
});

export const AboutStatsResponseSchema = z.object({
  stats: AboutStatsDataSchema.nullable(),
});

export type AboutStatsData = z.infer<typeof AboutStatsDataSchema>;
export type AboutStatsResponse = z.infer<typeof AboutStatsResponseSchema>;
