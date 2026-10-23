import { z } from "zod";

/**
 * MIG-0602 SA-004..006: request / result shapes for /api/admin/announcements.
 * Field-level validation (length, enum, JST datetime) stays in
 * @flamenode/domain/announcements validateAnnouncementInput; this schema only
 * pins the JSON transport shape so non-object / wrongly typed bodies are
 * rejected before the domain runs.
 */
const looseScalar = z.union([z.string(), z.number()]).nullish();

export const AnnouncementWriteBodySchema = z.object({
  id: z.string().optional(),
  base_updated_at: looseScalar,
  title: z.string().optional(),
  body: z.string().optional(),
  severity: z.string().optional(),
  target_audience: z.string().optional(),
  is_published: z.union([z.string(), z.number(), z.boolean()]).optional(),
  publish_at: z.string().nullish(),
  expire_at: z.string().nullish(),
});
export type AnnouncementWriteBody = z.infer<typeof AnnouncementWriteBodySchema>;

export const AnnouncementResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  id: z.string().optional(),
});
export type AnnouncementResultDto = z.infer<typeof AnnouncementResultSchema>;
