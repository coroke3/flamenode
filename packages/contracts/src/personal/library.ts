import { z } from "zod";
import { ChapterItemSchema, VideoCardSchema } from "./shared.ts";

// CURRENT: app/(auth)/dashboard/library/page.tsx

export const LibraryTabSchema = z.enum(["like", "bookmark", "mine", "collab", "chapters"]);

export const LibraryResponseSchema = z.object({
  tab: LibraryTabSchema,
  page: z.number(),
  pageSize: z.number(),
  hasNextPage: z.boolean(),
  /** like/bookmark only: the other tab has at least one row. */
  hasOtherTabHits: z.boolean(),
  /** mine only (CURRENT getOnboardingState().activeApprovedXId). */
  activeApprovedXId: z.string().nullable(),
  /** collab/chapters only; 0 on the other tabs (CURRENT leaves approvedXIds empty there). */
  approvedXIdCount: z.number(),
  videos: z.array(VideoCardSchema),
  chapters: z.array(ChapterItemSchema),
});

export type LibraryTab = z.infer<typeof LibraryTabSchema>;
export type LibraryResponse = z.infer<typeof LibraryResponseSchema>;
