import { z } from "zod";

/**
 * MIG-0603 U02b: chapter write bodies and results (SA-012..015).
 * CURRENT: src/lib/actions/chapter.ts createSchema / updateSchema / bulkSchema
 * and ChapterActionResult. The video id and chapter id are URL path
 * parameters on the Hono API, so they are not part of the body schemas.
 */

/** CURRENT MAX_ATOMIC_CHAPTER_BULK_ROWS (src/lib/actions/chapterLimits.ts). */
export const MAX_CHAPTER_BULK_ROWS = 8;
/** CURRENT bulkSchema csv.max(64 * 1024) (characters). */
export const MAX_CHAPTER_BULK_CSV_LENGTH = 64 * 1024;

const chapterFields = {
  // The raw string goes to validateChapterTime so invalid input is never rounded to 0 s.
  chapter_time: z.string().trim().min(1).max(32),
  chapter_label: z.string().trim().min(1).max(120),
  note: z.string().trim().max(1000).optional().nullable(),
  visibility: z.enum(["public", "private"]).default("public"),
};

/** Create (SA-012) and update (SA-013) share the CURRENT field rules. */
export const ChapterWriteBodySchema = z.object(chapterFields);
export type ChapterWriteBody = z.infer<typeof ChapterWriteBodySchema>;

export const ChapterBulkBodySchema = z.object({
  csv: z.string().min(1).max(MAX_CHAPTER_BULK_CSV_LENGTH),
});
export type ChapterBulkBody = z.infer<typeof ChapterBulkBodySchema>;

export const ChapterActionResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  chapterId: z.string().optional(),
  pendingPublicReflection: z.boolean().optional(),
});
export type ChapterActionResult = z.infer<typeof ChapterActionResultSchema>;

export const BulkChapterActionResultSchema = ChapterActionResultSchema.extend({
  inserted: z.number().int().optional(),
  skipped: z.number().int().optional(),
  errors: z.array(z.string()).optional(),
});
export type BulkChapterActionResult = z.infer<typeof BulkChapterActionResultSchema>;
