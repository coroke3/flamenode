import { z } from "zod";

/** MIG-0643 U04: SA-106 uses form field video_id; HTTP path is authoritative. */
export const AdminYoutubeResyncVideoIdSchema = z.string().trim().min(1).max(128);
export const AdminYoutubeResyncResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  already_pending: z.boolean().optional(),
});
export type AdminYoutubeResyncResult = z.infer<typeof AdminYoutubeResyncResultSchema>;

/** MIG-0643 U02: CURRENT SA-071 target type set, exact IDs and reason bounds. */
export const AdminStaticRebuildBodySchema = z.object({
  target_type: z.enum([
    "top", "top_recommended", "top_latest", "top_nostalgic",
    "top_events", "top_announcements", "top_stats", "top_slot_stats",
    "events_index", "event_base", "event_slots", "event_release",
    "event", "video", "user", "users_index", "list_recent",
    "list_popular", "search_index", "recommend_core", "recommend",
    "rules", "youtube_related_blocklist", "random_video_pool", "member_suggestions",
  ]),
  target_id: z.string().trim().min(1).max(128),
  reason: z.string().trim().min(1).max(500).default("manual_rebuild"),
});

export const AdminStaticRebuildResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
  queued: z.number().int().nonnegative().optional(),
  retried: z.number().int().nonnegative().optional(),
});
export type AdminStaticRebuildResult = z.infer<typeof AdminStaticRebuildResultSchema>;

/** MIG-0643 U03: SA-050 CURRENT manifest fence repair body. */
export const AdminVisibilityRepairBodySchema = z.object({
  entity_type: z.enum(["video", "event", "x_user", "event_group"]),
  entity_id: z.string().trim().min(1).max(128),
  fence_token: z.string().trim().min(1).max(160),
});
export const AdminVisibilityRepairResultSchema = z.object({
  visibility_repair: z.enum([
    "forbidden", "invalid_input", "d1_fence_present",
    "manifest_token_not_found", "repaired", "failed",
  ]),
});

/** MIG-0643 U02 SA-069: CURRENT FormData fields as bounded JSON. */
export const AdminStaticBackfillBodySchema = z.object({
  kind: z.enum(["video_v2", "user_profile", "event_crew"]),
  mode: z.string().optional().default("continue"),
  cursor: z.string().trim().max(128).optional().default(""),
});
