import { z } from "zod";
export const AboutStatsDataSchema = z.object({
    publicVideos: z.number(),
    creators: z.number(),
    events: z.number(),
});
export const AboutStatsResponseSchema = z.object({
    stats: AboutStatsDataSchema.nullable(),
});
