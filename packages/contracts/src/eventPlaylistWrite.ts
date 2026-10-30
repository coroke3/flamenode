import { z } from "zod";

/**
 * MIG-0655 SA-038 / SA-039: event YouTube playlist write API.
 * CURRENT: src/lib/actions/event-youtube-playlist.ts (FormData fields of the
 * same names; the route parameter replaces `event_id`). Values are coerced
 * with String() exactly like CURRENT's FormData reads, so the route keeps its
 * own CURRENT-equivalent parser (`parsePlaylistSettings`); this schema is the
 * client-facing shape, not an extra validation layer.
 */
export const EventPlaylistSettingsBodySchema = z.object({
  /** Playlist ID or youtube.com / youtu.be URL with `list=`; "" clears it. */
  playlist_id: z.string().optional(),
  sync_mode: z.enum(["off", "append_only", "mirror"]).optional(),
  /** Minutes; CURRENT clamps integers to 60..10080 and maps anything else to 720. */
  sync_interval_minutes: z.union([z.string(), z.number()]).optional(),
});
export type EventPlaylistSettingsBody = z.infer<typeof EventPlaylistSettingsBodySchema>;

/** PUT /api/manage/events/:eventId/youtube-playlist — CURRENT `?saved=1` / `?error=<message>`. */
export const EventPlaylistSettingsResultSchema = z.union([
  z.object({ ok: z.literal(true), saved: z.literal(true) }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);
export type EventPlaylistSettingsResult = z.infer<typeof EventPlaylistSettingsResultSchema>;

/** POST /api/manage/events/:eventId/youtube-playlist/sync — CURRENT `?queued=1` / `?error=<message>`. */
export const EventPlaylistSyncResultSchema = z.union([
  z.object({ ok: z.literal(true), queued: z.literal(true) }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);
export type EventPlaylistSyncResult = z.infer<typeof EventPlaylistSyncResultSchema>;
