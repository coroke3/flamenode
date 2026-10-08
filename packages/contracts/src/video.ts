import { z } from "zod";

export const VideoSummaryDtoSchema = z.object({
  id: z.string(),
  title: z.string(),
  youtubeId: z.string().nullable(),
  creatorXName: z.string(),
  visibilityStatus: z.enum(["public", "unlisted", "private", "voided"]),
});

export type VideoSummaryDto = z.infer<typeof VideoSummaryDtoSchema>;
